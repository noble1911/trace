//! Opening a paired peer's server and saying hello, and the checks a session
//! needs before it asks that machine to run anything. Every failure is a
//! sentence a person can act on, since it lands in the session's terminal or in
//! a tool's error.

use std::time::{Duration, Instant};

use super::link::{Connector, Link, LinkError};
use crate::execution::peer::capabilities::ServerCapabilities;
use crate::execution::peer::protocol::{Event, Request, PROTOCOL_VERSION};

const HELLO_WITHIN: Duration = Duration::from_secs(6);

/// Who we are to the server, for its log. Not a secret, not the user's name.
fn client_name() -> String {
    format!("trace ({})", std::env::consts::OS)
}

/// A paired peer as the client uses it. Holds the token: never log it.
#[derive(Clone)]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub token: String,
}

/// Open `peer`'s server and get past `hello`. Returns the live link and what
/// the server says it can do.
pub fn open(
    connector: &dyn Connector,
    peer: &Peer,
) -> Result<(Box<dyn Link>, ServerCapabilities), String> {
    let mut link = connector
        .connect(&peer.address)
        .map_err(|e| format!("Can't reach {}: {e}", peer.name))?;
    let hello = Request::Hello {
        protocol: PROTOCOL_VERSION,
        token: peer.token.clone(),
        client_name: client_name(),
    };
    if let Err(e) = link.send(&hello, Some(1)) {
        link.close();
        return Err(format!("Can't reach {}: {e}", peer.name));
    }
    let until = Instant::now() + HELLO_WITHIN;
    loop {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            link.close();
            return Err(format!("{} didn't answer hello.", peer.name));
        }
        match link.recv(left) {
            Ok(Some(Event::Welcome { capabilities })) => return Ok((link, capabilities)),
            Ok(Some(Event::Refused { reason })) => {
                link.close();
                return Err(format!(
                    "{} refused this trace: {reason} Pair again in Settings if the token changed.",
                    peer.name
                ));
            }
            Ok(_) => {}
            Err(LinkError::Unreachable(e) | LinkError::Lost(e)) => {
                link.close();
                return Err(format!("Lost {} during hello: {e}", peer.name));
            }
        }
    }
}

/// Whether `caps` can take a session of `cli` in `repo`: the agent is installed
/// there, it has the repo, and its window is open (agent tools run in the
/// server's renderer, which reports itself as `features.agentTools`).
pub fn check(
    caps: &ServerCapabilities,
    peer_name: &str,
    cli: &str,
    repo: &str,
) -> Result<(), String> {
    if !caps.agents.iter().any(|a| a == cli) {
        return Err(format!("{peer_name} can't run {cli}."));
    }
    if !caps.repos.iter().any(|r| r.name == repo) {
        let have: Vec<&str> = caps.repos.iter().map(|r| r.name.as_str()).collect();
        return Err(format!(
            "{peer_name} doesn't have the repository {repo}. It has: {}.",
            if have.is_empty() {
                "none".to_string()
            } else {
                have.join(", ")
            }
        ));
    }
    if !caps.features.agent_tools {
        return Err(format!(
            "{peer_name}'s trace window is closed: its agents need it open. Open trace there and try again."
        ));
    }
    Ok(())
}

#[cfg(test)]
#[path = "connect_tests.rs"]
mod tests;
