//! Provider commands (Jira, Pylon). Credentials never cross to the frontend —
//! only the resolved user/board data does. Every board command takes the target
//! provider, since several can be connected at once.

use tauri::State;

use crate::issues::models::{BoardData, BoardSummary, IssueUser, PullRequest};
use crate::issues::{IssueProvider, Provider, ProviderKind, ProviderSession};
use crate::jira::JiraConnection;
use crate::pylon::PylonConnection;
use crate::state::AppState;

/// Clone the named provider out of state (never hold the lock across `await`).
fn get_provider(state: &AppState, kind: ProviderKind) -> Result<Provider, String> {
    state
        .providers
        .read()
        .get(&kind)
        .cloned()
        .ok_or_else(|| match kind {
            ProviderKind::Jira => "Not connected to Jira.".to_string(),
            ProviderKind::Pylon => "Not connected to Pylon.".to_string(),
        })
}

/// Insert/update a provider connection and persist its credentials.
fn set_provider(state: &AppState, provider: Provider) -> Result<(), String> {
    match &provider {
        Provider::Jira(conn) => crate::jira::auth::save(conn)?,
        Provider::Pylon(conn) => crate::pylon::auth::save(conn)?,
    }
    state.providers.write().insert(provider.kind(), provider);
    Ok(())
}

#[tauri::command]
pub async fn connect_jira(
    state: State<'_, AppState>,
    site: String,
    email: String,
    token: String,
) -> Result<IssueUser, String> {
    let conn = JiraConnection {
        site: site.trim().to_string(),
        email: email.trim().to_string(),
        token: token.trim().to_string(),
    };
    if conn.site.is_empty() || conn.email.is_empty() || conn.token.is_empty() {
        return Err("Site, email, and API token are all required.".to_string());
    }
    let user = conn.current_user().await?;
    set_provider(&state, Provider::Jira(conn))?;
    Ok(user)
}

#[tauri::command]
pub async fn connect_pylon(state: State<'_, AppState>, token: String) -> Result<IssueUser, String> {
    let conn = PylonConnection::new(token.trim().to_string());
    if conn.token.is_empty() {
        return Err("An API token is required.".to_string());
    }
    // Validate resolves the API region (US/EU) — persist the resolved connection.
    let (user, conn) = crate::pylon::auth::validate(&conn).await?;
    set_provider(&state, Provider::Pylon(conn))?;
    Ok(user)
}

/// The sessions of all connected providers (non-secret details only) — lets the
/// UI skip the login screen on launch without exposing tokens.
#[tauri::command]
pub fn provider_sessions(state: State<'_, AppState>) -> Vec<ProviderSession> {
    state.providers.read().values().map(|p| p.session_info()).collect()
}

/// The authenticated user of one provider — used to pre-select the current
/// user in the board's assignee filter on launch.
#[tauri::command]
pub async fn provider_current_user(state: State<'_, AppState>, provider: String) -> Result<IssueUser, String> {
    let kind = ProviderKind::parse(&provider)?;
    get_provider(&state, kind)?.current_user().await
}

#[tauri::command]
pub fn disconnect_provider(state: State<'_, AppState>, provider: String) -> Result<(), String> {
    let kind = ProviderKind::parse(&provider)?;
    state.providers.write().remove(&kind);
    match kind {
        ProviderKind::Jira => crate::jira::auth::clear(),
        ProviderKind::Pylon => crate::pylon::auth::clear(),
    }
}

#[tauri::command]
pub async fn list_boards(state: State<'_, AppState>, provider: String) -> Result<Vec<BoardSummary>, String> {
    let kind = ProviderKind::parse(&provider)?;
    get_provider(&state, kind)?.list_boards().await
}

#[tauri::command]
pub async fn get_board(
    state: State<'_, AppState>,
    provider: String,
    board_id: String,
) -> Result<BoardData, String> {
    let kind = ProviderKind::parse(&provider)?;
    get_provider(&state, kind)?.get_board(&board_id).await
}

#[tauri::command]
pub async fn transition_issue(
    state: State<'_, AppState>,
    provider: String,
    issue_key: String,
    target_status_ids: Vec<String>,
) -> Result<(), String> {
    let kind = ProviderKind::parse(&provider)?;
    get_provider(&state, kind)?
        .transition_issue(&issue_key, &target_status_ids)
        .await
}

#[tauri::command]
pub async fn comment_on_issue(
    state: State<'_, AppState>,
    provider: String,
    issue_key: String,
    body: String,
) -> Result<(), String> {
    let kind = ProviderKind::parse(&provider)?;
    get_provider(&state, kind)?.add_comment(&issue_key, &body).await
}

/// PRs linked to an issue. `fresh` busts Jira's dev-status cache (re-syncs from
/// GitHub) — use for targeted single-issue refreshes, not bulk fan-outs. Other
/// providers have no dev-status integration and return an empty list.
#[tauri::command]
pub async fn get_issue_pull_requests(
    state: State<'_, AppState>,
    provider: String,
    issue_id: String,
    fresh: Option<bool>,
) -> Result<Vec<PullRequest>, String> {
    let kind = ProviderKind::parse(&provider)?;
    get_provider(&state, kind)?
        .get_pull_requests(&issue_id, fresh.unwrap_or(false))
        .await
}
