//! The [`ToolCaller`] over MCP's Streamable HTTP transport, logged in as
//! trace (`mcp_auth`). It opens a session on first use (`initialize`, then
//! `notifications/initialized`), sends the session id back when the server
//! gave one (a stateless server, like Pylon's, gives none), and re-opens it
//! once when the server says it has expired.

use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::Value;
use tokio::sync::Mutex;

use super::transport::{self, Reply, Session};
use super::{wire, ToolCaller, ToolInfo};
use crate::mcp_auth::catalog::Auth;
use crate::mcp_auth::store::Added;

/// Pages of `tools/list` read at most, in case a server never stops.
const MAX_PAGES: usize = 50;

/// A connection to one MCP server added in trace. Cheap to make: nothing is
/// sent until the first call.
pub struct HttpCaller {
    /// Whose login is used, and its name for messages.
    server: Added,
    /// Where requests go: the server's URL, or a variant of it (a query).
    endpoint: String,
    /// The open session; None until the first call, or after it expired.
    session: Mutex<Option<Session>>,
    next_id: AtomicU64,
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| url.to_string())
}

fn same_server(a: &str, b: &str) -> bool {
    let norm = |u: &str| u.trim_end_matches('/').to_ascii_lowercase();
    norm(a) == norm(b)
}

/// A caller for the server at `url`, which must be added in trace and, if
/// it uses OAuth, logged in to. `url` may carry a query (Atlassian's
/// `?tools=all`): the server is looked up without it and requests go to it
/// as given. Reads trace's small logins file; sends nothing.
pub fn for_url(url: &str) -> Result<HttpCaller, String> {
    let base = url.split('?').next().unwrap_or(url);
    let not_logged_in = || format!("trace isn't logged in to {}", host_of(url));
    let server = crate::mcp_auth::added()
        .into_iter()
        .find(|a| same_server(&a.url, base))
        .ok_or_else(not_logged_in)?;
    let has_grant = || {
        crate::mcp_auth::store::grants()
            .iter()
            .any(|g| g.url == server.url)
    };
    if server.auth == Auth::Oauth && !has_grant() {
        return Err(not_logged_in());
    }
    Ok(HttpCaller::new(server).with_endpoint(url))
}

impl HttpCaller {
    /// A caller for `server`, at its own URL.
    pub(crate) fn new(server: Added) -> Self {
        Self {
            endpoint: server.url.clone(),
            server,
            session: Mutex::new(None),
            next_id: AtomicU64::new(1),
        }
    }

    /// The same server's login, at another URL (the same server with a
    /// query, say). Only before the first call.
    pub fn with_endpoint(mut self, url: &str) -> Self {
        self.endpoint = url.to_string();
        self
    }

    /// Where its requests go.
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    fn id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    /// The open session, opening one if there's none. The lock is held
    /// while opening, so concurrent first calls share one `initialize`.
    async fn session(&self) -> Result<Session, String> {
        let mut slot = self.session.lock().await;
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
        let opened = self.initialize().await?;
        *slot = Some(opened.clone());
        Ok(opened)
    }

    /// Drop `stale`, unless another call already replaced it.
    async fn forget(&self, stale: &Session) {
        let mut slot = self.session.lock().await;
        if slot.as_ref() == Some(stale) {
            *slot = None;
        }
    }

    async fn initialize(&self) -> Result<Session, String> {
        let id = self.id();
        let body = wire::request(id, "initialize", wire::initialize_params());
        let posted = transport::post(&self.server, &self.endpoint, None, &body, Some(id)).await?;
        let Reply::Message(message) = posted.reply else {
            return Err(format!("{} didn't open a session.", self.server.name));
        };
        let result = wire::rpc_result(message)
            .map_err(|e| format!("{} refused to start: {e}", self.server.name))?;
        let session = Session {
            id: posted.session_id,
            version: wire::negotiated_version(&result),
        };
        let note = wire::notification("notifications/initialized");
        transport::post(&self.server, &self.endpoint, Some(&session), &note, None).await?;
        Ok(session)
    }

    /// One JSON-RPC request's result, in the session; re-opened and sent
    /// again once if the server says the session has expired.
    async fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let mut retried = false;
        loop {
            let session = self.session().await?;
            let id = self.id();
            let body = wire::request(id, method, params.clone());
            let posted = transport::post(
                &self.server,
                &self.endpoint,
                Some(&session),
                &body,
                Some(id),
            )
            .await?;
            match posted.reply {
                Reply::Message(message) => return wire::rpc_result(message),
                Reply::Expired if !retried => {
                    retried = true;
                    self.forget(&session).await;
                }
                Reply::Expired => {
                    return Err(format!("{} keeps losing its session.", self.server.name))
                }
                Reply::Accepted => return Err(format!("{} sent no answer.", self.server.name)),
            }
        }
    }
}

impl ToolCaller for HttpCaller {
    async fn call(&self, tool: &str, args: Value) -> Result<Value, String> {
        let result = self
            .rpc("tools/call", wire::tools_call_params(tool, args))
            .await?;
        wire::tool_value(tool, result)
    }

    async fn tools(&self) -> Result<Vec<ToolInfo>, String> {
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let params = wire::tools_list_params(cursor.as_deref());
            let result = self.rpc("tools/list", params).await?;
            let (page, next) = wire::tools_page(&result)?;
            out.extend(page);
            match wire::next_cursor(cursor.as_deref(), next) {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
#[path = "http_tests.rs"]
mod tests;
