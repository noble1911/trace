//! Connecting a tracker's board over its MCP server, with trace's own login
//! (`mcp_auth`) instead of an API key. Thin: the adapter is `jira_mcp`, the
//! choice of adapter `issues::mcp_link`. Pylon's MCP connect joins it here.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::issues::mcp_link;
use crate::issues::models::IssueUser;
use crate::issues::{IssueProvider, Provider, ProviderKind, ProviderSession};
use crate::jira_mcp::{self, site::Site, Opened};
use crate::mcp_auth::{catalog, flow, Source};
use crate::mcp_client::http;
use crate::state::AppState;

/// How a connect over MCP ended. No token, ever.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum McpConnected {
    /// Connected: who, and the session the rail and dialog show.
    #[serde(rename_all = "camelCase")]
    Connected {
        user: IssueUser,
        session: ProviderSession,
    },
    /// The login reaches several sites: connect again naming one.
    #[serde(rename_all = "camelCase")]
    ChooseSite { sites: Vec<Site> },
}

/// Log trace in to the MCP server at `url` through the browser, unless it
/// already is. The same login as Integrations → MCP servers, added there too.
async fn ensure_login(app: &AppHandle, url: &'static str) -> Result<(), String> {
    if mcp_link::logged_in(url) {
        return Ok(());
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let name = catalog::by_url(url).map_or("mcp", |k| k.name);
        flow::connect(&app, name, url, None, Source::Catalog, None).map(|_| ())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Connect Jira's board through trace's Atlassian login (logging in first if
/// need be). `cloud_id` picks the site when the login reaches several; without
/// it the saved site, or the only one, is used. Validated before anything is
/// saved: only then does it replace an API-token connection (whose
/// credentials are deleted).
#[tauri::command]
pub async fn connect_jira_mcp(
    app: AppHandle,
    state: State<'_, AppState>,
    cloud_id: Option<String>,
) -> Result<McpConnected, String> {
    ensure_login(&app, jira_mcp::SERVER_URL).await?;
    let caller = http::for_url(&jira_mcp::endpoint(jira_mcp::SERVER_URL))?;
    let saved = mcp_link::load(ProviderKind::Jira).and_then(|l| l.cloud_id);
    let wanted = cloud_id.or(saved);
    let conn = match jira_mcp::open(caller, wanted.as_deref()).await? {
        Opened::Ready(conn) => conn,
        Opened::ChooseSite(sites) => return Ok(McpConnected::ChooseSite { sites }),
    };
    let user = conn.current_user().await?;
    mcp_link::save(ProviderKind::Jira, &conn.link())?;
    crate::jira::auth::clear()?;
    let provider = Provider::JiraMcp(conn);
    let session = provider.session_info();
    state.providers.write().insert(ProviderKind::Jira, provider);
    Ok(McpConnected::Connected { user, session })
}
