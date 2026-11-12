//! The virtual board over MCP, as the REST adapter makes it (`pylon::board`):
//! base-state columns plus custom statuses before Closed, cards from issues
//! created in the last 30 days, closed ones kept 14 days.
//!
//! **The window.** REST asks `GET /issues` for a time range. Over MCP,
//! `search_issues` takes a `filter_json` (which Pylon's `build_filter` tool
//! builds; trace writes it in the grammar Pylon's REST search documents,
//! `{ field, operator, value }`, which is what `build_filter` emits). When the
//! tool's schema lists a filter argument, the window is asked for as
//! `created_at time_is_after <30 days ago>`. If it lists none, or the
//! filtered search fails or finds nothing (a server that misread the filter
//! would otherwise show an empty board), pages are read unfiltered and the
//! window is applied here. Reading stops early at the first page reaching
//! past the window only when the tool lists a `sort`, so newest-first was
//! really asked for; otherwise every page is read, up to the caps.
//!
//! **The caps.** At most `MAX_PAGES` pages and `pylon::board::MAX_ISSUES`
//! issues, as on REST (whose own cap is just as silent in the UI). Stopping at
//! a cap with pages left is logged, so a board that's missing cards can be
//! told apart from one that has none.

use serde_json::{json, Value};

use super::tools::{self, page_args};
use super::{parse, PylonMcp};
use crate::issues::models::{BoardColumn, BoardData, ColumnStatus, Issue};
use crate::mcp_client::args::{self, Arg};
use crate::mcp_client::ToolCaller;
use crate::pylon::board::{visible, MAX_ISSUES, OPEN_BOARD_ID};
use crate::pylon::models::{state_category, state_name, BASE_STATES};

/// The rolling window, as on REST.
const WINDOW_DAYS: i64 = 30;
const PAGE_SIZE: usize = 200;
/// Runaway guard on top of `MAX_ISSUES` (a server that ignores `limit`).
const MAX_PAGES: usize = 10;
const MAX_USER_PAGES: usize = 5;

/// The names a search tool might take its filter under.
const FILTER_KEYS: &[&str] = &["filter_json", "filter"];
/// The list keys a search result might use.
const ISSUE_KEYS: &[&str] = &["issues", "results", "items"];

/// The window as a Pylon filter.
pub fn window_filter(since: chrono::DateTime<chrono::Utc>) -> Value {
    json!({ "field": "created_at", "operator": "time_is_after", "value": since.to_rfc3339() })
}

/// The one virtual board's columns and cards (`open-issues`). Err for any
/// other board, and for issues trace can't read, rather than an empty board.
pub async fn get_board<T: ToolCaller>(
    c: &PylonMcp<T>,
    board_id: &str,
) -> Result<BoardData, String> {
    if board_id != OPEN_BOARD_ID {
        return Err(format!("Unknown Pylon board: {board_id}"));
    }
    let since = chrono::Utc::now() - chrono::Duration::days(WINDOW_DAYS);
    let (raw, statuses) = tokio::join!(fetch_issues(c, since), statuses(c));
    let raw: Vec<Value> = raw?
        .iter()
        .map(parse::normalise_issue)
        .filter(|v| parse::created(v).is_none_or(|t| t >= since))
        .collect();
    let names = user_names(c, &raw).await;
    let shown: Vec<&Value> = raw.iter().filter(|v| visible(v)).collect();
    let issues: Vec<Issue> = shown
        .iter()
        .filter_map(|v| parse::issue(v, &names))
        .collect();
    // Issues there but none readable is a payload trace doesn't understand,
    // not an empty board.
    if issues.is_empty() && !shown.is_empty() {
        return Err(format!(
            "Pylon's MCP server sent {} issues trace couldn't read.",
            shown.len()
        ));
    }
    Ok(BoardData {
        board_id: board_id.to_string(),
        board_name: "Pylon Issues".to_string(),
        sprint_name: None,
        columns: columns(&statuses, &issues),
        issues,
    })
}

/// The window's issues: filtered when the tool takes a filter, else (or if
/// that fails or finds nothing) unfiltered, the window applied by the caller.
async fn fetch_issues<T: ToolCaller>(
    c: &PylonMcp<T>,
    since: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<Value>, String> {
    let schema = c.toolset().await?.schema(&tools::SEARCH);
    let says_nothing = schema.and_then(|s| s.get("properties")).is_none();
    // Newest-first is only relied on when the tool says it takes a sort.
    let ordered = args::lists(schema, &["sort"]);
    if says_nothing || args::lists(schema, FILTER_KEYS) {
        match pages(c, Some(window_filter(since)), ordered, since).await {
            Ok(found) if !found.is_empty() => return Ok(found),
            _ => {}
        }
    }
    pages(c, None, ordered, since).await
}

/// Up to `MAX_PAGES` pages of `search_issues`. `ordered`: the tool takes the
/// newest-first sort, so the first page reaching past the window is the last
/// one needed.
async fn pages<T: ToolCaller>(
    c: &PylonMcp<T>,
    filter: Option<Value>,
    ordered: bool,
    since: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<Value>, String> {
    let mut out: Vec<Value> = Vec::new();
    let mut cursor: Option<String> = None;
    let mut cut_short = false;
    for _ in 0..MAX_PAGES {
        let mut args = page_args(PAGE_SIZE, cursor.as_deref());
        if let Some(f) = &filter {
            args.push(Arg::must(vec![
                ("filter_json", json!(f.to_string())),
                ("filter", f.clone()),
            ]));
        }
        let newest_first = json!({ "field": "created_at", "order": "desc" });
        args.push(Arg::opt(vec![("sort", newest_first)]));
        args.push(Arg::opt(vec![("include_messages", json!(false))]));
        let v = c.call(&tools::SEARCH, args).await?;
        let page = parse::listed(&v, ISSUE_KEYS, "issues")?;
        let oldest = page.last().and_then(parse::created);
        // Filtered, this never trips; it stops a server that ignored the filter.
        let past_window = ordered && oldest.is_some_and(|t| t < since);
        let empty = page.is_empty();
        out.extend(page);
        cursor = parse::next_cursor(&v);
        let done = empty || past_window || cursor.is_none();
        cut_short = !done;
        if done || out.len() >= MAX_ISSUES {
            break;
        }
    }
    if cut_short || out.len() > MAX_ISSUES {
        eprintln!(
            "trace: the Pylon board stopped at {} issues with more pages left; older ones aren't shown",
            out.len().min(MAX_ISSUES)
        );
    }
    out.truncate(MAX_ISSUES);
    Ok(out)
}

/// The organisation's live statuses (cached), or none: then custom ones are
/// discovered on the issues, as on REST.
async fn statuses<T: ToolCaller>(c: &PylonMcp<T>) -> Vec<parse::Status> {
    if let Some(s) = c.statuses_cache().get("") {
        return s;
    }
    if !c.offers(&tools::STATUSES).await {
        return Vec::new();
    }
    let found = c.call(&tools::STATUSES, Vec::new()).await;
    let statuses = found.map(|v| parse::statuses(&v)).unwrap_or_default();
    if !statuses.is_empty() {
        c.statuses_cache().put(String::new(), statuses.clone());
    }
    statuses
}

/// Assignees' names: from the issues themselves, and for any they don't name,
/// from `search_users` (cached; best effort, else the email's local part).
async fn user_names<T: ToolCaller>(c: &PylonMcp<T>, raw: &[Value]) -> parse::UserNames {
    let mut names = parse::names_on(raw);
    let unnamed = raw
        .iter()
        .filter_map(|i| i.get("assignee")?.get("id")?.as_str())
        .any(|id| !names.contains_key(id));
    if !unnamed || !c.offers(&tools::USERS).await {
        return names;
    }
    let users = match c.users_cache().get("") {
        Some(u) => u,
        None => fetch_users(c).await,
    };
    for (id, v) in users {
        names.entry(id).or_insert(v);
    }
    names
}

async fn fetch_users<T: ToolCaller>(c: &PylonMcp<T>) -> parse::UserNames {
    let mut out = parse::UserNames::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_USER_PAGES {
        let Ok(v) = c
            .call(&tools::USERS, page_args(100, cursor.as_deref()))
            .await
        else {
            break;
        };
        let page = parse::users(&v);
        let empty = page.is_empty();
        out.extend(page);
        cursor = parse::next_cursor(&v);
        if empty || cursor.is_none() {
            break;
        }
    }
    // An empty answer is a failed read: try again next time rather than keep it.
    if !out.is_empty() {
        c.users_cache().put(String::new(), out.clone());
    }
    out
}

fn status(slug: &str, name: String) -> ColumnStatus {
    ColumnStatus {
        id: slug.to_string(),
        name,
        category: state_category(slug),
    }
}

/// Base states in order; then the organisation's custom statuses, then any
/// other slug found on an issue, both before Closed.
pub fn columns(known: &[parse::Status], issues: &[Issue]) -> Vec<BoardColumn> {
    let mut out: Vec<ColumnStatus> = BASE_STATES
        .iter()
        .map(|(slug, name, _)| status(slug, name.to_string()))
        .collect();
    let closed_at = out.len() - 1;
    let mut custom: Vec<ColumnStatus> = Vec::new();
    let named = known
        .iter()
        .map(|s| (s.slug.as_str(), s.label.clone()))
        .chain(issues.iter().map(|i| (i.status_id.as_str(), None)));
    for (slug, label) in named {
        if !out.iter().chain(custom.iter()).any(|s| s.id == slug) {
            custom.push(status(slug, label.unwrap_or_else(|| state_name(slug))));
        }
    }
    out.splice(closed_at..closed_at, custom);
    out.into_iter()
        .map(|s| BoardColumn {
            name: s.name.clone(),
            statuses: vec![s],
        })
        .collect()
}
