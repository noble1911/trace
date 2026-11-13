//! What a server tells a client about itself in its `Welcome`: who it is, what
//! it can run and where. Small and versioned on purpose: the mobile apps read
//! it too, so nothing here is Tauri's or the renderer's, and nothing is local to
//! this machine. A repo is a name and a remote, never a folder; there is no
//! secret in it.

use serde::{Deserialize, Serialize};

use crate::execution::Capabilities;

/// One repo the server has, as a client may name it in `Spawn`.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    /// `owner/name` when the repo has a remote, else its folder's name.
    pub name: String,
    /// `host/owner/name`, when it has one.
    #[serde(default)]
    pub remote: Option<String>,
}

/// The server's answer to "what are you?". A field an older server leaves out
/// reads as empty, and one a newer server adds is ignored.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ServerCapabilities {
    /// The protocol the server speaks (`protocol::PROTOCOL_VERSION`).
    pub protocol: u32,
    /// The machine's name, e.g. "Ron's MacBook".
    pub name: String,
    /// `std::env::consts::OS`: "macos", "linux", "windows".
    pub os: String,
    /// The agent kinds it can start: "claude", "codex".
    pub agents: Vec<String>,
    pub repos: Vec<RepoSummary>,
    /// What its sessions offer beside the screen.
    pub features: Capabilities,
}

/// What a session served to a peer offers: the screen, and exact turns from the
/// server's hooks. Files, Transcript and Tests aren't in the protocol yet.
pub const SERVED_FEATURES: Capabilities = Capabilities {
    turn_hooks: true,
    transcript: false,
    files: false,
    terminal: false,
    tests: false,
    agent_tools: true,
    chat: false,
};

impl ServerCapabilities {
    pub fn new(name: &str, agents: Vec<String>, repos: Vec<RepoSummary>) -> Self {
        ServerCapabilities {
            protocol: super::protocol::PROTOCOL_VERSION,
            name: name.to_string(),
            os: std::env::consts::OS.to_string(),
            agents,
            repos,
            features: SERVED_FEATURES,
        }
    }
}

/// A repo as the client names it: its remote's `owner/name`, else its folder's.
pub fn summarize(path: &str, remote: Option<(&str, &str)>) -> RepoSummary {
    match remote {
        Some((host, full)) => RepoSummary {
            name: full.to_string(),
            remote: Some(format!("{host}/{full}")),
        },
        None => RepoSummary {
            name: std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "repo".to_string()),
            remote: None,
        },
    }
}

/// Leave out repos whose name another repo shares: a client names one in
/// `Spawn`, and a name that could mean two folders must not pick one silently.
pub fn drop_ambiguous<T>(repos: Vec<(RepoSummary, T)>) -> Vec<(RepoSummary, T)> {
    let count = |name: &str| repos.iter().filter(|(r, _)| r.name == name).count();
    let keep: Vec<bool> = repos.iter().map(|(r, _)| count(&r.name) == 1).collect();
    repos
        .into_iter()
        .zip(keep)
        .filter_map(|(repo, keep)| keep.then_some(repo))
        .collect()
}

#[cfg(test)]
#[path = "capabilities_tests.rs"]
mod tests;
