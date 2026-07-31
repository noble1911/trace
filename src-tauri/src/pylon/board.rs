//! Virtual board logic. Pylon has no board configuration: columns are Pylon's
//! issue states (base states, plus custom slugs discovered on issues) and cards
//! are the issues from a rolling 30-day window (`GET /issues` is time-bounded
//! to 30 days per call — this matches the "current work" scope of a sprint).

use std::collections::HashMap;

use serde_json::{json, Value};

use super::client;
use super::models::{parse_comment, parse_issue, state_category, state_name, BASE_STATES};
use super::PylonConnection;
use crate::issues::models::{BoardColumn, BoardData, BoardSummary, ColumnStatus, Issue, IssueComment};

const OPEN_BOARD_ID: &str = "open-issues";
/// Cap on issues fetched per board load (runaway guard, mirrors Jira's caps).
const MAX_ISSUES: usize = 1000;
/// Closed issues older than this are dropped — the Closed column shows recent
/// completions, not the org's whole history.
const CLOSED_KEEP_DAYS: i64 = 14;
/// Cap on thread messages fetched per brief (runaway guard, mirrors MAX_ISSUES).
const MAX_MESSAGES: usize = 200;

/// Pylon's virtual boards — the UI's board picker gets exactly one choice.
pub fn virtual_boards() -> Vec<BoardSummary> {
    vec![BoardSummary {
        id: OPEN_BOARD_ID.to_string(),
        name: "Pylon Issues".to_string(),
        board_type: "kanban".to_string(),
    }]
}

/// id → (display name, avatar) for every user, so assignees (id-only on
/// issues) can be labelled. Best effort: falls back to the email's local part.
async fn fetch_user_names(conn: &PylonConnection) -> HashMap<String, (String, Option<String>)> {
    let mut map = HashMap::new();
    if let Ok(v) = client::get(conn, "/users").await {
        for u in client::data(&v).as_array().cloned().unwrap_or_default() {
            if let Some(id) = u.get("id").and_then(Value::as_str) {
                let name = u
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .or_else(|| {
                        u.get("email")
                            .and_then(Value::as_str)
                            .and_then(|e| e.split('@').next())
                            .map(str::to_string)
                    });
                if let Some(name) = name {
                    let avatar = u.get("avatar_url").and_then(Value::as_str).map(str::to_string);
                    map.insert(id.to_string(), (name, avatar));
                }
            }
        }
    }
    map
}

/// The rolling window's issues. The response is
/// {"data": [...], "pagination": {"cursor", "has_next_page"}}.
async fn fetch_issues(conn: &PylonConnection) -> Result<Vec<Value>, String> {
    let end = chrono::Utc::now();
    let start = end - chrono::Duration::days(30);
    let start_s = start.to_rfc3339();
    let end_s = end.to_rfc3339();
    let mut out: Vec<Value> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut query = vec![
            ("start_time", start_s.as_str()),
            ("end_time", end_s.as_str()),
            ("limit", "200"),
        ];
        if let Some(c) = cursor.as_deref() {
            query.push(("cursor", c));
        }
        let v = client::get_query(conn, "/issues", &query).await?;
        out.extend(client::data(&v).as_array().cloned().unwrap_or_default());
        let pagination = v.get("pagination");
        let has_next = pagination
            .and_then(|p| p.get("has_next_page"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        cursor = pagination
            .and_then(|p| p.get("cursor"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if !has_next || cursor.is_none() || out.len() >= MAX_ISSUES {
            break;
        }
    }
    Ok(out)
}

/// Columns: base states in order, with any custom slugs discovered on issues
/// inserted before `closed`.
fn build_columns(issues: &[Issue]) -> Vec<BoardColumn> {
    let mut statuses: Vec<ColumnStatus> = BASE_STATES
        .iter()
        .map(|(slug, name, cat)| ColumnStatus {
            id: slug.to_string(),
            name: name.to_string(),
            category: cat.to_string(),
        })
        .collect();
    let closed_pos = statuses.len() - 1;
    let mut custom: Vec<ColumnStatus> = Vec::new();
    for issue in issues {
        let slug = &issue.status_id;
        if !statuses.iter().chain(custom.iter()).any(|s| &s.id == slug) {
            custom.push(ColumnStatus {
                id: slug.clone(),
                name: state_name(slug),
                category: state_category(slug),
            });
        }
    }
    statuses.splice(closed_pos..closed_pos, custom);
    statuses
        .into_iter()
        .map(|s| BoardColumn {
            name: s.name.clone(),
            statuses: vec![s],
        })
        .collect()
}

/// Keep closed issues only if resolved/updated recently (see CLOSED_KEEP_DAYS).
fn visible(issue: &Value) -> bool {
    let state = issue.get("state").and_then(Value::as_str).unwrap_or("new");
    if state != "closed" {
        return true;
    }
    let ts = issue
        .get("resolution_time")
        .or_else(|| issue.get("updated_at"))
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());
    match ts {
        Some(t) => chrono::Utc::now().signed_duration_since(t.with_timezone(&chrono::Utc))
            < chrono::Duration::days(CLOSED_KEEP_DAYS),
        None => true,
    }
}

pub async fn get_board(conn: &PylonConnection, board_id: &str) -> Result<BoardData, String> {
    if board_id != OPEN_BOARD_ID {
        return Err(format!("Unknown Pylon board: {board_id}"));
    }
    let (raw, user_names) = {
        // Users are best-effort; issues are required.
        let users = fetch_user_names(conn).await;
        (fetch_issues(conn).await?, users)
    };
    let issues: Vec<Issue> = raw
        .iter()
        .filter(|v| visible(v))
        .filter_map(|v| parse_issue(v, &user_names))
        .collect();
    let columns = build_columns(&issues);
    Ok(BoardData {
        board_id: board_id.to_string(),
        board_name: "Pylon Issues".to_string(),
        sprint_name: None,
        columns,
        issues,
    })
}

/// Move an issue to the target state. Unlike Jira, Pylon has no workflow gates —
/// the first target status is the destination. `issue_key` is the card key
/// (`#123`); the API accepts an issue number in place of an id.
pub async fn transition_to_state(
    conn: &PylonConnection,
    issue_key: &str,
    target_state_slugs: &[String],
) -> Result<(), String> {
    let Some(state) = target_state_slugs.first() else {
        return Err("No target status given.".to_string());
    };
    let id = issue_key.trim_start_matches('#');
    let path = format!("/issues/{id}");
    client::patch(conn, &path, json!({ "state": state })).await?;
    Ok(())
}

/// Post an internal note on the issue (Pylon's comment equivalent). Plain text
/// is HTML-escaped and wrapped one paragraph per line.
pub async fn add_note(conn: &PylonConnection, issue_key: &str, text: &str) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Comment body is empty.".to_string());
    }
    let escape = |s: &str| {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
    };
    let paragraphs: Vec<String> = trimmed.lines().map(|l| format!("<p>{}</p>", escape(l))).collect();
    let id = issue_key.trim_start_matches('#');
    let path = format!("/issues/{id}/note");
    client::post(conn, &path, json!({ "body_html": paragraphs.join("") })).await?;
    Ok(())
}

/// The issue's full conversation thread — customer messages and internal
/// notes — oldest-first. Paginates `GET /issues/{id}/messages`; `issue_id`
/// is the native Pylon id (the API also accepts the issue number).
pub async fn list_comments(conn: &PylonConnection, issue_id: &str) -> Result<Vec<IssueComment>, String> {
    let id = issue_id.trim_start_matches('#');
    let path = format!("/issues/{id}/messages");
    let mut out: Vec<IssueComment> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let mut query = vec![("limit", "100")];
        if let Some(c) = cursor.as_deref() {
            query.push(("cursor", c));
        }
        let v = client::get_query(conn, &path, &query).await?;
        if let Some(arr) = client::data(&v).as_array() {
            out.extend(arr.iter().filter_map(parse_comment));
        }
        let pagination = v.get("pagination");
        let has_next = pagination
            .and_then(|p| p.get("has_next_page"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        cursor = pagination
            .and_then(|p| p.get("cursor"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        if !has_next || cursor.is_none() || out.len() >= MAX_MESSAGES {
            break;
        }
    }
    Ok(out)
}
