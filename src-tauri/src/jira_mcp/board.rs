//! The board over MCP: the list of boards, and one board's columns and cards,
//! the way the REST adapter (`jira::board`) does it.
//!
//! What a board shows is built as JQL by `jira::scope` and searched with
//! `searchJiraIssuesUsingJql`, following `nextPageToken`, rather than taken
//! from `getJiraBoardIssueData`: that tool's scope ("board", "backlog") is
//! the Agile endpoint's, which hides epics and ignores the done cutoff. The
//! saved filter is referenced as `filter = <id>` when the config doesn't carry
//! its JQL. Two settings come from a screen MCP doesn't reach (the done cutoff
//! and the Kanban backlog column), so Jira's defaults per board type apply, as
//! they do on REST without board-admin rights; a column the config itself
//! flags as the backlog is still dropped.
//!
//! Never a silently wrong board: a config with no filter or no columns, a
//! payload trace can't read, or a column whose statuses can't be placed
//! (`statuses`) is an error the board shows, not a board.

use std::collections::HashSet;

use serde_json::{json, Value};

use super::config::{self, BoardConfig};
use super::tools::{self, CARD_FIELDS};
use super::{parse, statuses, JiraMcp};
use crate::issues::models::{BoardData, BoardSummary, Issue};
use crate::jira::scope::{self, BoardSettings};
use crate::mcp_client::args::Arg;
use crate::mcp_client::ToolCaller;

/// Runaway guards, as on REST.
const MAX_BOARDS: usize = 2000;
const MAX_ISSUES: usize = 5000;

/// Everything about a board but its issues and sprint (cached).
#[derive(Clone)]
pub struct BoardScope {
    pub name: String,
    pub board_type: String,
    pub config: BoardConfig,
}

/// Every board the user can see, following the pages (`startAt`/`isLast`,
/// or a `nextPageToken`). A page that adds nothing new ends it, so a server
/// that ignores `startAt` can't loop.
pub async fn list_boards<T: ToolCaller>(c: &JiraMcp<T>) -> Result<Vec<BoardSummary>, String> {
    if let Some(boards) = c.inner.boards.get("all") {
        return Ok(boards);
    }
    let mut out: Vec<BoardSummary> = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let mut args = vec![
            c.cloud(),
            Arg::opt(vec![("maxResults", json!(50))]),
            Arg::opt(vec![("startAt", json!(out.len()))]),
        ];
        if let Some(t) = &token {
            args.push(Arg::must(vec![
                ("nextPageToken", json!(t)),
                ("cursor", json!(t)),
            ]));
        }
        let v = c.call(&tools::BOARDS, args).await?;
        let before = out.len();
        for b in parse::boards(&v)? {
            if !out.iter().any(|o| o.id == b.id) {
                out.push(b);
            }
        }
        token = parse::text(&v, &["nextPageToken", "cursor"]).map(str::to_string);
        let more = token.is_some() || v.get("isLast").and_then(Value::as_bool) == Some(false);
        if !more || out.len() == before || out.len() >= MAX_BOARDS {
            break;
        }
    }
    c.inner.boards.put("all".into(), out.clone());
    Ok(out)
}

/// The board's name, type and configuration (cached). Err, and nothing
/// cached, when the configuration lacks a filter or columns.
async fn board_scope<T: ToolCaller>(c: &JiraMcp<T>, board_id: &str) -> Result<BoardScope, String> {
    if let Some(scope) = c.inner.scopes.get(board_id) {
        return Ok(scope);
    }
    let board = Arg::must(vec![
        ("boardId", json!(board_id)),
        ("board_id", json!(board_id)),
        ("id", json!(board_id)),
    ]);
    let (config, boards) = tokio::join!(
        c.call(&tools::BOARD_CONFIG, vec![c.cloud(), board]),
        list_boards(c)
    );
    let config = config::board_config(&config?);
    config.filter()?;
    let listed = boards
        .ok()
        .and_then(|bs| bs.into_iter().find(|b| b.id == board_id));
    let scope = BoardScope {
        name: listed
            .as_ref()
            .map(|b| b.name.clone())
            .or_else(|| config.name.clone())
            .unwrap_or_else(|| format!("Board {board_id}")),
        board_type: listed
            .map(|b| b.board_type)
            .or_else(|| config.board_type.clone())
            .unwrap_or_else(|| "kanban".to_string()),
        config,
    };
    c.inner.scopes.put(board_id.to_string(), scope.clone());
    Ok(scope)
}

/// The running sprint's name, if the board has one. Best effort: no sprint
/// tool, or a failed call, shows the board's filter (as between sprints).
async fn open_sprint<T: ToolCaller>(c: &JiraMcp<T>, board_id: &str) -> Option<String> {
    if !c.offers(&tools::SPRINTS).await {
        return None;
    }
    let args = vec![
        c.cloud(),
        Arg::must(vec![
            ("boardId", json!(board_id)),
            ("board_id", json!(board_id)),
        ]),
        Arg::opt(vec![("state", json!("active"))]),
    ];
    let v = c.call(&tools::SPRINTS, args).await.ok()?;
    parse::active_sprint(&v)
}

/// Every issue `jql` finds, all pages, each once. Paging ends at the last
/// page, at a token the server already gave (it would loop), or at a page that
/// adds no issue not already seen (a server that ignores the token).
pub async fn search<T: ToolCaller>(c: &JiraMcp<T>, jql: &str) -> Result<Vec<Issue>, String> {
    let jql = format!("{jql} ORDER BY Rank ASC");
    let mut out: Vec<Issue> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut tokens: HashSet<String> = HashSet::new();
    let mut token: Option<String> = None;
    loop {
        let mut args = vec![
            c.cloud(),
            Arg::need("jql", json!(jql)),
            Arg::opt(vec![("fields", json!(CARD_FIELDS))]),
            Arg::opt(vec![("maxResults", json!(100))]),
            // ADF: descriptions render as the REST adapter's do.
            Arg::opt(vec![("responseContentFormat", json!("adf"))]),
        ];
        if let Some(t) = &token {
            args.push(Arg::need("nextPageToken", json!(t)));
        }
        let v = c.call(&tools::SEARCH, args).await?;
        let (issues, next) = parse::issue_page(&v)?;
        let before = out.len();
        for issue in issues {
            if seen.insert(issue.key.clone()) {
                out.push(issue);
            }
        }
        token = next.filter(|t| tokens.insert(t.clone()));
        if token.is_none() || out.len() == before || out.len() >= MAX_ISSUES {
            break;
        }
    }
    Ok(out)
}

/// Columns + cards for one board.
pub async fn get_board<T: ToolCaller>(c: &JiraMcp<T>, board_id: &str) -> Result<BoardData, String> {
    let scope = board_scope(c, board_id).await?;
    let mut settings = BoardSettings::defaults(&scope.board_type);
    settings.backlog_statuses = scope.config.backlog_statuses.clone();
    let sprint = match settings.sprint_support {
        true => open_sprint(c, board_id).await,
        false => None,
    };
    // Checked when the scope was read: never an unscoped search.
    let filter = scope.config.filter()?;
    let jql = scope::board_jql(
        Some(&filter),
        scope.config.sub_query.as_deref(),
        &settings,
        sprint.is_some(),
    );
    let (issues, meta) = tokio::join!(search(c, &jql), statuses::site_statuses(c));
    let issues = issues?;
    let mut columns = scope::visible_columns(scope.config.columns, &settings.backlog_statuses);
    statuses::fill(&mut columns, &meta, &issues);
    let unplaced = statuses::unplaced(&columns);
    if !unplaced.is_empty() {
        let found = statuses::look_up(c, &unplaced).await;
        statuses::fill(&mut columns, &found, &[]);
    }
    let columns = statuses::finish(columns)?;
    Ok(BoardData {
        board_id: board_id.to_string(),
        board_name: scope.name,
        sprint_name: sprint.filter(|n| !n.is_empty()),
        columns,
        issues,
    })
}
