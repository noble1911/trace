//! Which adapter a tracker's board uses: its REST API or its MCP server.
//!
//! The rule, per tracker: saved API credentials win; else a saved "use the MCP
//! login for the board" record ([`McpLink`], `<tracker>-mcp.json`) plus trace's
//! login to that server (`mcp_auth`) means the MCP adapter; else it isn't
//! connected. A record without a login (logged out in Integrations → MCP
//! servers) is left on disk: logging in again brings the board back.
//!
//! Generic over the tracker, so each MCP adapter plugs in the same way: its
//! `connect_<tracker>_mcp` saves a record and clears the API credentials, its
//! API connect clears the record ([`clear`]), and `session::restore_all` asks
//! [`restore`] which one to build.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::ProviderKind;
use crate::helpers::persist::{self, Style};

/// "Use this MCP server's login for this tracker's board". No token: the
/// login itself stays in `mcp_auth`'s file, which agents use too.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLink {
    /// The tracker's MCP server (Atlassian v2; Pylon US or EU).
    pub server_url: String,
    /// Jira: the site (cloudId) the board reads. None where there's no choice.
    #[serde(default)]
    pub cloud_id: Option<String>,
    /// The site's URL and name, for display and browse links.
    #[serde(default)]
    pub site_url: Option<String>,
    #[serde(default)]
    pub site_name: Option<String>,
}

/// Which adapter to build.
#[derive(Debug, PartialEq)]
pub enum Pick<A> {
    /// The REST adapter, with these saved credentials.
    Api(A),
    /// The MCP adapter, from this record.
    Mcp(McpLink),
}

/// The rule, pure: API credentials, else a record whose server is logged in.
pub fn pick<A>(
    api: Option<A>,
    link: Option<McpLink>,
    logged_in: impl Fn(&str) -> bool,
) -> Option<Pick<A>> {
    if let Some(api) = api {
        return Some(Pick::Api(api));
    }
    link.filter(|l| logged_in(&l.server_url)).map(Pick::Mcp)
}

/// The rule, on what's saved: `api` is the tracker's saved API credentials.
pub fn restore<A>(kind: ProviderKind, api: Option<A>) -> Option<Pick<A>> {
    pick(api, load(kind), logged_in)
}

/// Whether trace holds a login for the MCP server at `url`.
pub fn logged_in(url: &str) -> bool {
    let norm = |u: &str| u.trim_end_matches('/').to_ascii_lowercase();
    crate::mcp_auth::store::grants()
        .iter()
        .any(|g| norm(&g.url) == norm(url))
}

fn file_name(kind: ProviderKind) -> Option<&'static str> {
    match kind {
        ProviderKind::Jira => Some("jira-mcp.json"),
        ProviderKind::Pylon => Some("pylon-mcp.json"),
        ProviderKind::Custom => None,
    }
}

fn path(kind: ProviderKind) -> Option<PathBuf> {
    file_name(kind).map(|f| crate::helpers::trace_dir().join(f))
}

/// The tracker's record, if one is saved (and readable).
pub fn load(kind: ProviderKind) -> Option<McpLink> {
    persist::read_or_log::<Option<McpLink>>(&path(kind)?)
}

/// Save the tracker's record: its board now uses the MCP login.
pub fn save(kind: ProviderKind, link: &McpLink) -> Result<(), String> {
    let path = path(kind).ok_or("Custom boards have no MCP server.")?;
    persist::write_json(&path, Style::Pretty, link)
}

/// Forget the record (connecting by API key, or disconnecting the tracker).
/// The MCP login stays: agents use it.
pub fn clear(kind: ProviderKind) {
    if let Some(path) = path(kind) {
        persist::remove(&path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link() -> McpLink {
        McpLink {
            server_url: "https://mcp.atlassian.com/v2/mcp".into(),
            cloud_id: Some("c1".into()),
            site_url: Some("https://acme.atlassian.net".into()),
            site_name: Some("acme".into()),
        }
    }

    #[test]
    fn saved_api_credentials_win() {
        let picked = pick(Some("token"), Some(link()), |_| true);
        assert_eq!(picked, Some(Pick::Api("token")));
    }

    #[test]
    fn a_record_with_a_login_picks_mcp() {
        let picked = pick(None::<&str>, Some(link()), |url| url.contains("atlassian"));
        assert_eq!(picked, Some(Pick::Mcp(link())));
    }

    #[test]
    fn a_record_without_a_login_is_not_connected() {
        assert_eq!(pick(None::<&str>, Some(link()), |_| false), None);
        assert_eq!(pick(None::<&str>, None, |_| true), None);
    }

    #[test]
    fn a_record_reads_back_with_missing_fields() {
        let v: McpLink = serde_json::from_str(r#"{ "serverUrl": "https://mcp.usepylon.com" }"#)
            .expect("a Pylon record");
        assert_eq!(v.cloud_id, None);
    }
}
