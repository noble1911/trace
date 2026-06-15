//! Jira commands. Credentials never cross to the frontend — only the resolved
//! user/board data does.

use serde::Serialize;
use tauri::State;

use crate::jira::models::{BoardData, BoardSummary, JiraUser, PullRequest};
use crate::jira::{auth, board, dev, JiraConnection};
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JiraSession {
    pub site: String,
    pub email: String,
}

/// Clone the active connection out of state (never hold the lock across `await`).
fn current_conn(state: &AppState) -> Result<JiraConnection, String> {
    state
        .jira
        .read()
        .clone()
        .ok_or_else(|| "Not connected to Jira.".to_string())
}

/// The authenticated user (via `/myself`) — used to pre-select the current user
/// in the board's assignee filter on launch.
#[tauri::command]
pub async fn jira_current_user(state: State<'_, AppState>) -> Result<JiraUser, String> {
    let conn = current_conn(&state)?;
    auth::validate(&conn).await
}

#[tauri::command]
pub async fn connect_jira(
    state: State<'_, AppState>,
    site: String,
    email: String,
    token: String,
) -> Result<JiraUser, String> {
    let conn = JiraConnection {
        site: site.trim().to_string(),
        email: email.trim().to_string(),
        token: token.trim().to_string(),
    };
    if conn.site.is_empty() || conn.email.is_empty() || conn.token.is_empty() {
        return Err("Site, email, and API token are all required.".to_string());
    }
    let user = auth::validate(&conn).await?;
    auth::save(&conn)?;
    *state.jira.write() = Some(conn);
    Ok(user)
}

/// The current connection (site/email only) if logged in — lets the UI skip the
/// login screen on launch without exposing the token.
#[tauri::command]
pub fn jira_session(state: State<'_, AppState>) -> Option<JiraSession> {
    state.jira.read().as_ref().map(|c| JiraSession {
        site: c.site.clone(),
        email: c.email.clone(),
    })
}

#[tauri::command]
pub fn disconnect_jira(state: State<'_, AppState>) -> Result<(), String> {
    *state.jira.write() = None;
    auth::clear()
}

#[tauri::command]
pub async fn list_jira_boards(state: State<'_, AppState>) -> Result<Vec<BoardSummary>, String> {
    let conn = current_conn(&state)?;
    board::list_boards(&conn).await
}

#[tauri::command]
pub async fn get_jira_board(
    state: State<'_, AppState>,
    board_id: i64,
) -> Result<BoardData, String> {
    let conn = current_conn(&state)?;
    board::get_board(&conn, board_id).await
}

#[tauri::command]
pub async fn get_issue_pull_requests(
    state: State<'_, AppState>,
    issue_id: String,
    fresh: Option<bool>,
) -> Result<Vec<PullRequest>, String> {
    let conn = current_conn(&state)?;
    dev::get_pull_requests(&conn, &issue_id, fresh.unwrap_or(false)).await
}

#[tauri::command]
pub async fn transition_jira_issue(
    state: State<'_, AppState>,
    issue_key: String,
    target_status_ids: Vec<String>,
) -> Result<(), String> {
    let conn = current_conn(&state)?;
    board::transition_to_status(&conn, &issue_key, &target_status_ids).await
}

#[tauri::command]
pub async fn comment_on_issue(
    state: State<'_, AppState>,
    issue_key: String,
    body: String,
) -> Result<(), String> {
    let conn = current_conn(&state)?;
    board::add_comment(&conn, &issue_key, &body).await
}
