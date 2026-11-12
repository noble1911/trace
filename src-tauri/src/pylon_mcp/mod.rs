//! Pylon over Pylon's MCP server, with trace's own login (`mcp_auth`) rather
//! than an API token. One more adapter behind `issues::IssueProvider`, with
//! the REST adapter's board exactly (`pylon/`): one virtual board, columns
//! from the base states plus custom statuses (before Closed), cards from a
//! rolling 30-day window with closed ones kept 14 days, keys `#<number>`,
//! moves by state slug, comments as **internal notes**, no PRs.
//!
//! It depends on `mcp_client::ToolCaller`, never on HTTP: the app gives it an
//! `HttpCaller`, tests a `FakeCaller`. Tool names and argument shapes live in
//! `tools`, result reading in `parse`, the board in `board`, one issue's
//! operations in `issue`, which server (US or EU) in `region`. Which adapter
//! a Pylon connection uses is `issues::mcp_link`'s rule.

pub mod board;
pub mod issue;
pub mod parse;
pub mod region;
pub mod tools;

#[cfg(test)]
mod issue_tests;
#[cfg(test)]
mod live;
#[cfg(test)]
mod tests;

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::OnceCell;

use crate::helpers::ttl_cache::TtlCache;
use crate::issues::mcp_link::McpLink;
use crate::issues::models::{BoardData, BoardSummary, IssueComment, IssueUser, PullRequest};
use crate::issues::{IssueProvider, ProviderKind, ProviderSession, Via};
use crate::mcp_client::args::Arg;
use crate::mcp_client::http::{self, HttpCaller};
use crate::mcp_client::ToolCaller;
use tools::{Op, Toolset};

/// The organisation's users and statuses change rarely; issues are never kept.
const META_TTL: Duration = Duration::from_secs(30 * 60);

/// A Pylon connection over MCP, to one region's server. Clones share it.
pub struct PylonMcp<T: ToolCaller> {
    inner: Arc<Inner<T>>,
}

/// The app's connection.
pub type PylonMcpConnection = PylonMcp<HttpCaller>;

struct Inner<T> {
    caller: T,
    /// The server it talks to (US or EU), saved in the record.
    server_url: String,
    /// The server's tools, read once (on connect, or on first use after a launch).
    toolset: OnceCell<Toolset>,
    users: TtlCache<parse::UserNames>,
    statuses: TtlCache<Vec<parse::Status>>,
}

impl<T: ToolCaller> Clone for PylonMcp<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

/// `https://mcp.eu.usepylon.com/` → `mcp.eu.usepylon.com`.
fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    rest.split('/').next().unwrap_or(rest).to_string()
}

/// Connect: read the server's tools, failing with one sentence if the
/// board's aren't there. `current_user` validates the login after.
pub async fn open<T: ToolCaller>(caller: T, server_url: &str) -> Result<PylonMcp<T>, String> {
    let tools = Toolset::from_list(caller.tools().await?)?;
    Ok(PylonMcp::build(caller, server_url, OnceCell::from(tools)))
}

/// The saved connection, from its record: no network until first use.
pub fn from_link(link: &McpLink) -> Result<PylonMcpConnection, String> {
    Ok(PylonMcp::new(
        http::for_url(&link.server_url)?,
        &link.server_url,
    ))
}

impl<T: ToolCaller> PylonMcp<T> {
    /// A connection to the server at `server_url`; its tools are read on first use.
    pub fn new(caller: T, server_url: &str) -> Self {
        Self::build(caller, server_url, OnceCell::new())
    }

    fn build(caller: T, server_url: &str, toolset: OnceCell<Toolset>) -> Self {
        Self {
            inner: Arc::new(Inner {
                caller,
                server_url: server_url.to_string(),
                toolset,
                users: TtlCache::new(META_TTL),
                statuses: TtlCache::new(META_TTL),
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn caller(&self) -> &T {
        &self.inner.caller
    }

    /// The record that brings this connection back on the next launch.
    pub fn link(&self) -> McpLink {
        McpLink {
            server_url: self.inner.server_url.clone(),
            cloud_id: None,
            site_url: None,
            site_name: None,
        }
    }

    pub(crate) async fn toolset(&self) -> Result<&Toolset, String> {
        let caller = &self.inner.caller;
        let list = || async { Toolset::from_list(caller.tools().await?) };
        self.inner.toolset.get_or_try_init(list).await
    }

    /// Whether the server offers `op` (for the optional ones).
    pub(crate) async fn offers(&self, op: &Op) -> bool {
        self.toolset().await.is_ok_and(|t| t.offers(op))
    }

    /// Run `op` with `args`, shaped by its schema.
    pub(crate) async fn call(&self, op: &Op, args: Vec<Arg>) -> Result<Value, String> {
        let tools = self.toolset().await?;
        let args = tools.args(op, args);
        self.inner.caller.call(op.name, args).await
    }

    pub(crate) fn users_cache(&self) -> &TtlCache<parse::UserNames> {
        &self.inner.users
    }

    pub(crate) fn statuses_cache(&self) -> &TtlCache<Vec<parse::Status>> {
        &self.inner.statuses
    }
}

impl<T: ToolCaller> IssueProvider for PylonMcp<T> {
    async fn current_user(&self) -> Result<IssueUser, String> {
        Ok(parse::me(&self.call(&tools::ME, Vec::new()).await?))
    }

    async fn list_boards(&self) -> Result<Vec<BoardSummary>, String> {
        Ok(crate::pylon::board::virtual_boards())
    }

    async fn get_board(&self, board_id: &str) -> Result<BoardData, String> {
        board::get_board(self, board_id).await
    }

    async fn transition_issue(
        &self,
        issue_key: &str,
        target_status_ids: &[String],
    ) -> Result<(), String> {
        issue::transition(self, issue_key, target_status_ids).await
    }

    async fn add_comment(&self, issue_key: &str, body: &str) -> Result<(), String> {
        issue::add_note(self, issue_key, body).await
    }

    async fn list_comments(&self, issue_id: &str) -> Result<Vec<IssueComment>, String> {
        issue::list_comments(self, issue_id).await
    }

    /// Pylon has no dev-status integration: no PR badges on its cards.
    async fn get_pull_requests(
        &self,
        _issue_id: &str,
        _fresh: bool,
    ) -> Result<Vec<PullRequest>, String> {
        Ok(Vec::new())
    }

    async fn status_category(&self, issue_key: &str) -> Result<String, String> {
        issue::status_category(self, issue_key).await
    }

    fn session_info(&self) -> ProviderSession {
        ProviderSession {
            provider: ProviderKind::Pylon,
            // The server's host, so Integrations says which region it's on.
            site: Some(host_of(&self.inner.server_url)),
            email: None,
            via: Via::Mcp,
        }
    }
}
