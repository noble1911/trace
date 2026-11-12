//! MCP servers for trace's agents (Integrations → MCP servers): a curated list
//! of popular ones (`catalog`), the HTTP ones in your Claude config
//! (`servers`), and any you add. trace logs in to each itself, once per
//! person (`flow`, `oauth`), and keeps the tokens (`store`). Each server has
//! two switches: agents on this computer reach it through trace's loopback
//! proxy, which adds a fresh token to every call (`proxy`); agents in a cloud
//! sandbox get it by URL, the token added by the sandbox's network
//! (`execution::sandbox::egress`). The VM, config files and command lines
//! never hold a token.

pub mod cards;
pub mod catalog;
#[cfg(test)]
mod catalog_live;
pub mod flow;
pub mod oauth;
pub mod proxy;
pub mod servers;
pub mod store;

use serde::Serialize;

use crate::execution::sandbox::egress::Injection;
use catalog::Auth;
use store::Added;

/// Where a server in the list came from.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Catalog,
    /// Your Claude config, where local agents already have it.
    Config,
    Custom,
}

/// A server as Integrations → MCP servers shows it. No token.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub name: String,
    pub url: String,
    pub host: String,
    pub source: Source,
    /// Its logo, for one from trace's list (several entries can share one).
    pub logo: Option<String>,
    pub about: Option<String>,
    pub auth: Auth,
    pub key_hint: Option<String>,
    /// Added in trace (and, for OAuth, logged in).
    pub connected: bool,
    pub local: bool,
    pub remote: bool,
    /// Epoch ms the current token expires, when the server said.
    pub expires_at: Option<u64>,
    /// trace can renew it without the browser.
    pub refreshable: bool,
    /// The service retired this URL: where it moved (connecting there replaces it).
    pub replaced_by: Option<String>,
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default()
}

/// Every server added in trace: those added with their switches, and any
/// logged in to before switches existed (sandboxes only, as it was then).
pub fn added() -> Vec<Added> {
    let mut out = store::added();
    for g in store::grants() {
        if !out.iter().any(|a| a.url == g.url) {
            out.push(Added {
                name: g.name,
                url: g.url,
                auth: Auth::Oauth,
                key: None,
                local: false,
                remote: true,
                logo: None,
            });
        }
    }
    out
}

/// Where a server new to trace is used: everywhere, except one your Claude
/// config already gives local agents.
pub fn default_use(source: Source) -> (bool, bool) {
    (source != Source::Config, true)
}

/// The list: the catalog, your Claude config's servers, and what you added.
pub fn statuses() -> Vec<ServerStatus> {
    let added = added();
    let grants = store::grants();
    let status = |name: &str, url: &str, source: Source, auth: Auth| {
        let replacement = catalog::replacing(url);
        let known = catalog::by_url(url).or(replacement);
        let a = added.iter().find(|a| a.url == url);
        let grant = grants.iter().find(|g| g.url == url);
        let auth = a.map_or(auth, |a| a.auth);
        ServerStatus {
            name: a.map_or(name, |a| a.name.as_str()).to_string(),
            url: url.to_string(),
            host: host_of(url),
            source,
            logo: known
                .map(|k| k.logo.to_string())
                .or_else(|| a.and_then(|a| a.logo.clone())),
            about: known.map(|k| k.about.to_string()),
            auth,
            key_hint: known.and_then(|k| k.key_hint).map(str::to_string),
            connected: a.is_some() && (auth != Auth::Oauth || grant.is_some()),
            local: a.is_some_and(|a| a.local),
            remote: a.is_some_and(|a| a.remote),
            expires_at: grant.and_then(|g| g.expires_at),
            refreshable: grant.is_some_and(|g| g.refresh_token.is_some()),
            replaced_by: replacement.map(|k| k.url.to_string()),
        }
    };
    let norm = |u: &str| u.trim_end_matches('/').to_ascii_lowercase();
    let config = servers::discover();
    let added_urls: Vec<&str> = added.iter().map(|a| a.url.as_str()).collect();
    let mut out: Vec<ServerStatus> = cards::catalog_cards(&added_urls, &config, &known_regions())
        .into_iter()
        .map(|c| status(&c.name, c.known.url, c.source, c.known.auth))
        .collect();
    let listed = |out: &[ServerStatus], url: &str| out.iter().any(|s| norm(&s.url) == norm(url));
    for s in config {
        let folded = catalog::replacing(&s.url).is_some_and(|k| listed(&out, k.url));
        if !folded && !listed(&out, &s.url) {
            out.push(status(&s.name, &s.url, Source::Config, Auth::Oauth));
        }
    }
    for a in &added {
        if !listed(&out, &a.url) {
            out.push(status(&a.name, &a.url, Source::Custom, a.auth));
        }
    }
    out
}

/// Your region per service, where trace knows it: Pylon's, from the
/// connected Pylon tracker (its MCP record or its API connection).
fn known_regions() -> Vec<(&'static str, catalog::Region)> {
    crate::pylon_mcp::region::known()
        .map(|r| vec![("pylon", r)])
        .unwrap_or_default()
}

/// The header that logs a call in to `server`, fresh: Err when its OAuth
/// login has expired and can't be renewed. None for an open server.
pub fn auth_header(server: &Added) -> Result<Option<(String, String)>, String> {
    match server.auth {
        Auth::Open => Ok(None),
        Auth::Key => Ok(server.key.clone()),
        Auth::Oauth => {
            let grant = store::grants()
                .into_iter()
                .find(|g| g.url == server.url)
                .ok_or_else(|| format!("trace isn't logged in to {}.", server.name))?;
            let g = store::fresh(grant)?;
            Ok(Some((
                "Authorization".to_string(),
                format!("Bearer {}", g.access_token),
            )))
        }
    }
}

/// What a sandbox gets of the added servers.
#[derive(Debug, Default)]
pub struct ForSandbox {
    /// Each server's login, for its host and path.
    pub injections: Vec<Injection>,
    /// `--mcp-config` for Claude: the servers by URL, no headers. None if none.
    pub config: Option<String>,
    /// Servers left out (their login expired), by name.
    pub left_out: Vec<String>,
}

/// Every server switched on for sandboxes, with a login good for a while
/// (refreshed if need be). Blocking: a refresh asks the server.
pub fn for_sandbox() -> ForSandbox {
    let mut out = ForSandbox::default();
    let mut config = serde_json::Map::new();
    for server in added().into_iter().filter(|a| a.remote) {
        let header = match auth_header(&server) {
            Ok(h) => h,
            Err(_) => {
                out.left_out.push(server.name);
                continue;
            }
        };
        let Ok(u) = reqwest::Url::parse(&server.url) else {
            continue;
        };
        if let Some(header) = header {
            let path = u.path().trim_end_matches('/');
            out.injections.push(Injection {
                domain: host_of(&server.url),
                headers: vec![header],
                path_prefix: (!path.is_empty()).then(|| path.to_string()),
                ..Injection::default()
            });
        }
        config.insert(
            server.name.clone(),
            serde_json::json!({ "type": "http", "url": server.url }),
        );
    }
    if !config.is_empty() {
        out.config = Some(serde_json::json!({ "mcpServers": config }).to_string());
    }
    out
}

/// The servers switched on for this computer, by name and proxy slug: what
/// `agent_tools::mcp_config_arg` adds beside trace's own tools.
pub fn local() -> Vec<(String, String)> {
    added()
        .into_iter()
        .filter(|a| a.local)
        .map(|a| (a.name.clone(), a.slug()))
        .collect()
}
