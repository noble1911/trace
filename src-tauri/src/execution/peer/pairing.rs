//! Pairing two traces. The server keeps one token; a client that has it can
//! connect. The user moves it across as a pairing code, a single line to paste
//! now and to scan as a QR code from the mobile apps later.
//!
//! Both sides keep what they know in user-only (`0600`) files, like the tracker
//! credentials. Tokens never cross to the renderer and are never logged: the
//! renderer sees a [`PeerSummary`], never a [`PairedPeer`].

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::claude::render_bridge::constant_time_eq;
use crate::helpers::persist::{self, Style};
use crate::helpers::trace_dir;

/// What a pairing code starts with, so a pasted line is recognisably one.
const CODE_PREFIX: &str = "trace-pair:";

/// A fresh token: two v4 UUIDs, 244 random bits, as 64 hex digits.
fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

/// Whether `token` has the shape [`new_token`] makes. The length isn't secret,
/// so checking it before the constant-time compare leaks nothing.
fn well_formed(token: &str) -> bool {
    token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit())
}

// ---- server side ------------------------------------------------------------

#[derive(Serialize, Deserialize, Default)]
struct ServerFile {
    token: Option<String>,
}

fn server_file() -> PathBuf {
    trace_dir().join("peer-server.json")
}

/// This trace's pairing token, made the first time it's asked for.
pub fn server_token() -> Result<String, String> {
    persist::update(&server_file(), Style::Compact, |f: &mut ServerFile| {
        f.token.get_or_insert_with(new_token).clone()
    })
}

/// Replace the token. Every paired client has to pair again.
pub fn rotate_server_token() -> Result<String, String> {
    persist::update(&server_file(), Style::Compact, |f: &mut ServerFile| {
        let token = new_token();
        f.token = Some(token.clone());
        token
    })
}

/// Whether a client's `Hello` carries this server's token.
pub fn accepts(expected: &str, given: &str) -> bool {
    well_formed(given) && constant_time_eq(expected.as_bytes(), given.as_bytes())
}

// ---- the code that carries it ---------------------------------------------

/// Where a server is and how to get in: `trace-pair:<host>:<port>/<token>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PairingCode {
    /// `host:port` on the tailnet.
    pub address: String,
    pub token: String,
}

impl PairingCode {
    pub fn encode(&self) -> String {
        format!("{CODE_PREFIX}{}/{}", self.address, self.token)
    }

    /// Read a pasted code, forgiving the whitespace a copy picks up.
    pub fn parse(code: &str) -> Result<PairingCode, String> {
        let bad = || "That isn't a trace pairing code.".to_string();
        let rest = code.trim().strip_prefix(CODE_PREFIX).ok_or_else(bad)?;
        let (address, token) = rest.rsplit_once('/').ok_or_else(bad)?;
        let (host, port) = address.rsplit_once(':').ok_or_else(bad)?;
        if host.is_empty() || port.parse::<u16>().is_err() || !well_formed(token) {
            return Err(bad());
        }
        if !is_tailnet_host(host) {
            return Err(OUTSIDE_TAILNET.to_string());
        }
        Ok(PairingCode {
            address: address.to_string(),
            token: token.to_string(),
        })
    }
}

/// A host a peer's token may be sent to: a Tailscale address, so neither a pasted
/// code nor a saved peer can send it to a server somewhere else. Any `*.ts.net` name passes, another
/// tailnet's included: the check is "points at Tailscale", not "is my tailnet".
pub fn is_tailnet_host(host: &str) -> bool {
    let host = host
        .trim_matches(|c| c == '[' || c == ']')
        .to_ascii_lowercase();
    if host.ends_with(".ts.net") && host.len() > ".ts.net".len() {
        return host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
    }
    if host.starts_with("fd7a:115c:a1e0:") {
        return host.bytes().all(|b| b.is_ascii_hexdigit() || b == b':');
    }
    // 100.64.0.0/10
    let mut parts = host.split('.').map(str::parse::<u8>);
    matches!(
        (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next()
        ),
        (
            Some(Ok(100)),
            Some(Ok(64..=127)),
            Some(Ok(_)),
            Some(Ok(_)),
            None
        )
    )
}

/// What to tell the user when a host fails [`is_tailnet_host`].
pub const OUTSIDE_TAILNET: &str =
    "That address is outside your tailnet, so trace won't send it a pairing token.";

// ---- client side ------------------------------------------------------------

/// A server this trace has paired with. Holds its token, so it stays Rust-side.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairedPeer {
    /// Ours, so the user can rename it without re-pairing.
    pub id: String,
    /// The server's host name, from its `Welcome`.
    pub name: String,
    pub address: String,
    pub token: String,
}

/// A paired peer as the renderer sees it: no token.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerSummary {
    pub id: String,
    pub name: String,
    pub address: String,
}

impl From<&PairedPeer> for PeerSummary {
    fn from(p: &PairedPeer) -> Self {
        PeerSummary {
            id: p.id.clone(),
            name: p.name.clone(),
            address: p.address.clone(),
        }
    }
}

fn peers_file() -> PathBuf {
    trace_dir().join("peers.json")
}

/// Every paired peer, tokens included: for the client connecting to them.
pub fn paired_peers() -> Vec<PairedPeer> {
    persist::read_or_log(&peers_file())
}

/// Remember a peer, replacing one already paired at the same address.
pub fn save_peer(code: &PairingCode, name: &str) -> Result<PeerSummary, String> {
    persist::update(
        &peers_file(),
        Style::Pretty,
        |peers: &mut Vec<PairedPeer>| upsert(peers, code, name),
    )
}

/// Forget a peer. Its server keeps running and keeps its token.
pub fn remove_peer(id: &str) -> Result<(), String> {
    persist::update(
        &peers_file(),
        Style::Pretty,
        |peers: &mut Vec<PairedPeer>| {
            peers.retain(|p| p.id != id);
        },
    )
}

fn upsert(peers: &mut Vec<PairedPeer>, code: &PairingCode, name: &str) -> PeerSummary {
    let id = peers
        .iter()
        .find(|p| p.address == code.address)
        .map(|p| p.id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    peers.retain(|p| p.address != code.address);
    let peer = PairedPeer {
        id,
        name: name.to_string(),
        address: code.address.clone(),
        token: code.token.clone(),
    };
    let summary = PeerSummary::from(&peer);
    peers.push(peer);
    summary
}

#[cfg(test)]
#[path = "pairing_tests.rs"]
mod tests;
