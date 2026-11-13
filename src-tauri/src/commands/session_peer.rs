//! Sessions that run on a paired peer: turning a record's `SessionHost::Peer`
//! into a host, vetting a new one (paired, reachable, has the repo, window open),
//! and keeping the peer's id for the session on the record so Start rejoins it.

use std::sync::Arc;

use crate::commands::session::update;
use crate::execution::peer::client::connect::{check, open, Peer};
use crate::execution::peer::client::host::PeerHost;
use crate::execution::peer::client::link::Connector;
use crate::execution::peer::client::ws::WsConnector;
use crate::execution::peer::pairing::{paired_peers, PairedPeer};
use crate::execution::{Host, SessionHost};

/// What `create_session`'s `host` says when it means a peer: `peer:<paired id>`.
const PREFIX: &str = "peer:";

/// The paired peer id in a host choice, if it is one.
pub(crate) fn peer_id(choice: &str) -> Option<&str> {
    choice.strip_prefix(PREFIX)
}

fn client_peer(p: &PairedPeer) -> Peer {
    Peer {
        id: p.id.clone(),
        name: p.name.clone(),
        address: p.address.clone(),
        token: p.token.clone(),
    }
}

/// The paired peer called `id_or_name` (its id, or its name without regard to
/// case: an agent knows a computer by name), or why there isn't one.
pub(crate) fn find(peers: &[PairedPeer], id_or_name: &str) -> Result<Peer, String> {
    let by_name: Vec<&PairedPeer> = peers
        .iter()
        .filter(|p| p.name.eq_ignore_ascii_case(id_or_name))
        .collect();
    peers
        .iter()
        .find(|p| p.id == id_or_name)
        .or(match by_name[..] {
            [only] => Some(only),
            _ => None,
        })
        .map(client_peer)
        .ok_or_else(|| "That computer isn't paired. Pair it in Settings first.".to_string())
}

/// The host for a new session on a peer, or why it can't be. Asks the peer
/// (hello only, nothing is started) so an unreachable or closed one is refused
/// here, in words, rather than after a session exists.
pub(crate) fn new_host(choice: &str, repo: Option<&str>, cli: &str) -> Result<SessionHost, String> {
    let id = peer_id(choice).ok_or("Not a peer.")?;
    let repo = repo
        .filter(|r| !r.trim().is_empty())
        .ok_or("Pick one of that computer's repositories.")?;
    vet(&WsConnector, &paired_peers(), id, repo, cli)
}

/// [`new_host`] with its connection and peers supplied, for tests.
pub(crate) fn vet(
    connector: &dyn Connector,
    peers: &[PairedPeer],
    id: &str,
    repo: &str,
    cli: &str,
) -> Result<SessionHost, String> {
    let peer = find(peers, id)?;
    let (mut link, caps) = open(connector, &peer)?;
    link.close();
    check(&caps, &peer.name, cli, repo)?;
    Ok(SessionHost::Peer {
        peer: peer.id,
        repo: repo.to_string(),
        remote_id: None,
    })
}

/// The host a recorded peer session runs on.
pub(crate) fn host(
    title: &str,
    peer: &str,
    repo: &str,
    remote_id: Option<&str>,
) -> Result<Host, String> {
    let peer = find(&paired_peers(), peer)?;
    let connector: Arc<dyn Connector> = Arc::new(WsConnector);
    Ok(Host::Peer(Box::new(PeerHost::new(
        connector,
        peer,
        repo.to_string(),
        remote_id.map(str::to_string),
        title.to_string(),
    ))))
}

/// Record the peer's id for `workspace_id`'s agent (or forget it), so Start
/// attaches to the one running there instead of starting another.
pub(crate) fn set_peer_remote(workspace_id: &str, remote_id: Option<&str>) -> Result<(), String> {
    update(|sessions| {
        for s in sessions.iter_mut().filter(|s| s.id == workspace_id) {
            if let Some(SessionHost::Peer {
                remote_id: slot, ..
            }) = &mut s.host
            {
                *slot = remote_id.map(str::to_string);
            }
        }
    })
}

/// Make the record for a new session on a peer. The peer is asked first
/// (`new_host`), so an unpaired, unreachable or closed one makes no session.
pub(crate) fn create(
    title: String,
    cli: String,
    repo: Option<&str>,
    choice: Option<&str>,
    created_by: Option<crate::commands::session_origin::CreatedBy>,
) -> Result<crate::commands::session::ScratchSession, String> {
    let host = new_host(choice.unwrap_or_default(), repo, &cli)?;
    let session = crate::commands::session::ScratchSession {
        id: crate::helpers::new_id(),
        title,
        cli,
        provider: None,
        created_at: crate::commands::session::now_secs(),
        archived_at: None,
        tab: None,
        section: None,
        worktree: false,
        repo: None,
        folder: None,
        agents: Vec::new(),
        remote_control: false,
        created_by: created_by.and_then(crate::commands::session_origin::CreatedBy::sanitize),
        host: Some(host),
    };
    update(|list| list.push(session.clone()))?;
    Ok(session)
}

#[cfg(test)]
#[path = "session_peer_tests.rs"]
mod tests;
