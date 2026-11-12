//! Jira over Atlassian's MCP server (Rovo MCP v2), with trace's own login
//! (`mcp_auth`) rather than an API token. One more adapter behind
//! `issues::IssueProvider`, with the same board semantics as the REST one
//! (`jira/`): columns from the board's configuration, cards from exactly what
//! it shows (`jira::scope` builds the JQL), transitions by target status.
//!
//! It depends on `mcp_client::ToolCaller`, never on HTTP: the app gives it an
//! `HttpCaller`, tests a `FakeCaller` with recorded payloads. Tool names and
//! argument shapes live in `tools`, payload reading in `parse`, and reaching
//! tools the server keeps behind `discover`/`execute*` in `route`. Which
//! adapter a Jira connection uses is `issues::mcp_link`'s rule.

pub mod board;
pub mod config;
pub mod issue;
mod linked;
pub mod parse;
mod route;
pub mod site;
mod statuses;
pub mod tools;

#[cfg(test)]
mod guard_tests;
#[cfg(test)]
mod issue_tests;
#[cfg(test)]
mod live;
#[cfg(test)]
mod live_probe;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod v2_tests;

use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::OnceCell;

use crate::helpers::ttl_cache::TtlCache;
use crate::issues::mcp_link::McpLink;
use crate::issues::models::{BoardData, BoardSummary, IssueComment, IssueUser, PullRequest};
use crate::issues::{IssueProvider, ProviderKind, ProviderSession, Via};
use crate::mcp_client::args::Arg;
use crate::mcp_client::http::{self, HttpCaller};
use crate::mcp_client::ToolCaller;
use site::Site;
use tools::{Op, Toolset};

/// Atlassian's MCP server: the same login as Integrations → MCP servers.
pub const SERVER_URL: &str = "https://mcp.atlassian.com/v2/mcp";

/// What a board is (columns, filter) and the site's boards and statuses
/// change rarely; issues are never kept.
const META_TTL: Duration = Duration::from_secs(10 * 60);

/// Where the adapter's calls go: the server with every tool listed flat,
/// rather than most of them behind `discover`.
pub fn endpoint(server_url: &str) -> String {
    format!("{}?tools=all", server_url.trim_end_matches('/'))
}

/// A Jira connection over MCP, on one site. Clones share one connection.
pub struct JiraMcp<T: ToolCaller> {
    inner: Arc<Inner<T>>,
}

/// The app's connection.
pub type JiraMcpConnection = JiraMcp<HttpCaller>;

struct Inner<T> {
    caller: T,
    site: Site,
    /// The server's tools, read once (on connect, or on first use after a launch).
    toolset: OnceCell<Toolset>,
    boards: TtlCache<Vec<BoardSummary>>,
    scopes: TtlCache<board::BoardScope>,
    statuses: TtlCache<parse::StatusMeta>,
}

impl<T: ToolCaller> Clone for JiraMcp<T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

/// What connecting found: a connection, or several sites to pick from.
pub enum Opened<T: ToolCaller> {
    Ready(JiraMcp<T>),
    ChooseSite(Vec<Site>),
}

/// Connect: read the server's tools (failing with one sentence if the board's
/// aren't there), then find the login's Jira sites and take `wanted` (a saved
/// or chosen cloudId), or the only one.
pub async fn open<T: ToolCaller>(caller: T, wanted: Option<&str>) -> Result<Opened<T>, String> {
    let tools = Toolset::from_list(caller.tools().await?)?;
    let found = site::sites(&call_with(&caller, &tools, &tools::SITES, Vec::new()).await?);
    if found.is_empty() {
        return Err("Your Atlassian login can't reach any Jira site.".to_string());
    }
    Ok(match site::choose(found, wanted) {
        Ok(site) => Opened::Ready(JiraMcp::build(caller, site, OnceCell::from(tools))),
        Err(sites) => Opened::ChooseSite(sites),
    })
}

/// Whether `url` is Atlassian's MCP server, the only one the adapter talks to.
fn is_atlassian(url: &str) -> bool {
    let norm = |u: &str| u.trim().trim_end_matches('/').to_ascii_lowercase();
    norm(url) == norm(SERVER_URL)
}

/// The saved connection, from its record: no network until first use. A
/// record naming another server is refused: the record is a file on disk, and
/// trace's Atlassian login must only ever go to Atlassian.
pub fn from_link(link: &McpLink) -> Result<JiraMcpConnection, String> {
    if !is_atlassian(&link.server_url) {
        return Err(format!(
            "The saved Jira connection names {}, not Atlassian's MCP server. Connect Jira again.",
            link.server_url
        ));
    }
    let id = link.cloud_id.clone().ok_or("No Jira site is saved.")?;
    let url = link.site_url.clone().unwrap_or_default();
    let site = Site {
        name: link.site_name.clone().unwrap_or_else(|| url.clone()),
        id,
        url,
    };
    Ok(JiraMcp::new(
        http::for_url(&endpoint(&link.server_url))?,
        site,
    ))
}

async fn call_with<T: ToolCaller>(
    caller: &T,
    tools: &Toolset,
    op: &Op,
    args: Vec<Arg>,
) -> Result<Value, String> {
    let name = tools
        .name(op)
        .ok_or_else(|| format!("Atlassian's MCP server doesn't offer {}.", op.names[0]))?;
    let args = tools.args(name, args);
    let (tool, args, wrapped) = tools.dispatch(name, args, op.write);
    let value = caller.call(&tool, args).await?;
    let value = if wrapped { route::unwrap(value) } else { value };
    // The real v2 server puts every answer under `data`, and reports a failed
    // Jira call as `{ error: true, message }` in an otherwise successful result.
    let value = route::unwrap(parse::failure(name, value)?);
    // A read's answer is parsed as JSON: text in its place mustn't read as empty.
    match op.write {
        true => Ok(value),
        false => parse::readable(name, value),
    }
}

impl<T: ToolCaller> JiraMcp<T> {
    /// A connection to `site`; its tools are read on first use.
    pub fn new(caller: T, site: Site) -> Self {
        Self::build(caller, site, OnceCell::new())
    }

    fn build(caller: T, site: Site, toolset: OnceCell<Toolset>) -> Self {
        Self {
            inner: Arc::new(Inner {
                caller,
                site,
                toolset,
                boards: TtlCache::new(META_TTL),
                scopes: TtlCache::new(META_TTL),
                statuses: TtlCache::new(META_TTL),
            }),
        }
    }

    /// The Jira site every call names (by its cloudId).
    pub fn site(&self) -> &Site {
        &self.inner.site
    }

    #[cfg(test)]
    pub(crate) fn caller(&self) -> &T {
        &self.inner.caller
    }

    /// The record that brings this connection back on the next launch.
    pub fn link(&self) -> McpLink {
        McpLink {
            server_url: SERVER_URL.to_string(),
            cloud_id: Some(self.inner.site.id.clone()),
            site_url: Some(self.inner.site.url.clone()),
            site_name: Some(self.inner.site.name.clone()),
        }
    }

    async fn toolset(&self) -> Result<&Toolset, String> {
        let caller = &self.inner.caller;
        let list = || async { Toolset::from_list(caller.tools().await?) };
        self.inner.toolset.get_or_try_init(list).await
    }

    /// Whether the server can do `op` (for the optional ones).
    pub(crate) async fn offers(&self, op: &Op) -> bool {
        self.toolset().await.is_ok_and(|t| t.name(op).is_some())
    }

    /// Run `op` with `args`.
    pub(crate) async fn call(&self, op: &Op, mut args: Vec<Arg>) -> Result<Value, String> {
        let tools = self.toolset().await?;
        // Tools with a `view` answer compactly by default (no status ids or
        // categories, which columns are matched by): ask for Jira's own shape.
        // Sent only to tools whose schema lists it.
        args.push(Arg::opt(vec![("view", json!("full"))]));
        call_with(&self.inner.caller, tools, op, args).await
    }

    /// The site argument every Jira tool takes.
    pub(crate) fn cloud(&self) -> Arg {
        Arg::need("cloudId", json!(self.inner.site.id))
    }
}

impl<T: ToolCaller> IssueProvider for JiraMcp<T> {
    async fn current_user(&self) -> Result<IssueUser, String> {
        let cloud = Arg::opt(vec![("cloudId", json!(self.inner.site.id))]);
        let v = self.call(&tools::ME, vec![cloud]).await?;
        parse::user(&v)
    }

    async fn list_boards(&self) -> Result<Vec<BoardSummary>, String> {
        board::list_boards(self).await
    }

    async fn get_board(&self, board_id: &str) -> Result<BoardData, String> {
        board::get_board(self, board_id).await
    }

    async fn transition_issue(
        &self,
        key: &str,
        target_status_ids: &[String],
    ) -> Result<(), String> {
        issue::transition(self, key, target_status_ids).await
    }

    async fn add_comment(&self, key: &str, body: &str) -> Result<(), String> {
        issue::add_comment(self, key, body).await
    }

    async fn list_comments(&self, issue_id: &str) -> Result<Vec<IssueComment>, String> {
        issue::list_comments(self, issue_id).await
    }

    async fn get_pull_requests(
        &self,
        issue_id: &str,
        _fresh: bool,
    ) -> Result<Vec<PullRequest>, String> {
        issue::pull_requests(self, issue_id).await
    }

    async fn status_category(&self, key: &str) -> Result<String, String> {
        issue::status_category(self, key).await
    }

    fn session_info(&self) -> ProviderSession {
        ProviderSession {
            provider: ProviderKind::Jira,
            // The host, as the REST connection's: browse links are built from it.
            site: Some(self.inner.site.host()),
            email: None,
            via: Via::Mcp,
        }
    }
}
