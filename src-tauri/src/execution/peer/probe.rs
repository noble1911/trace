//! Asking one address whether a trace peer server answers, and what it says.
//!
//! The transport is behind [`Prober`] so discovery and pairing are tested against
//! a fake. [`WsProber`] is the real one: a plain WebSocket to the tailnet address
//! (the tailnet encrypts it), one `Hello`, one reply, closed. The token in a
//! `Hello` is never logged, and never part of an error.

use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tungstenite::Message;

use super::protocol::{Envelope, Event, Request, PROTOCOL_VERSION};
use crate::execution::Capabilities;

/// The port a peer server listens on, on its tailnet address. Moves to
/// `protocol.rs` with the server.
pub const PEER_PORT: u16 = 47821;

/// How long to wait for a connection, and then for the reply. A tailnet answers
/// in milliseconds; a sleeping or filtered device mustn't stall the list.
const WAIT: Duration = Duration::from_millis(1500);

/// A token no server has, for finding out whether a trace is there at all.
pub const NO_TOKEN: &str = "";

/// What a `Welcome` says about a server.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    pub host_name: String,
    pub protocol: u32,
    pub capabilities: Capabilities,
    pub os: Option<String>,
    /// "claude", "codex": the agents it can run.
    pub agent_kinds: Vec<String>,
    /// Display names of the repos it has, never paths.
    pub repos: Vec<String>,
}

/// What one probe found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Probe {
    /// Nothing answered, or what answered wasn't a trace peer.
    Silent,
    /// A trace answered and refused the token it was given.
    Refused,
    /// A trace answered and let us in.
    Welcome(PeerInfo),
}

/// Send one `Hello` to `address` (`host:port`) and give back the first reply frame.
pub trait Prober: Sync {
    fn exchange(&self, address: &str, hello: &str) -> Result<String, String>;
}

/// The real transport.
pub struct WsProber;

impl Prober for WsProber {
    fn exchange(&self, address: &str, hello: &str) -> Result<String, String> {
        let addr = address
            .to_socket_addrs()
            .map_err(|_| "unresolvable".to_string())?
            .next()
            .ok_or("unresolvable")?;
        let tcp = TcpStream::connect_timeout(&addr, WAIT).map_err(|_| "no answer".to_string())?;
        let _ = tcp.set_read_timeout(Some(WAIT));
        let _ = tcp.set_write_timeout(Some(WAIT));
        let url = format!("ws://{address}/");
        let (mut ws, _) =
            tungstenite::client(url.as_str(), tcp).map_err(|_| "not a peer".to_string())?;
        ws.send(Message::text(hello))
            .map_err(|_| "send failed".to_string())?;
        let reply = loop {
            match ws.read().map_err(|_| "no reply".to_string())? {
                Message::Text(t) => break t.to_string(),
                Message::Close(_) => return Err("closed".into()),
                _ => {}
            }
        };
        let _ = ws.close(None);
        Ok(reply)
    }
}

/// The `Hello` frame for `token`, from `client_name` (this machine's name).
pub fn hello_frame(token: &str, client_name: &str) -> String {
    let hello = Envelope {
        id: None,
        request: Request::Hello {
            protocol: PROTOCOL_VERSION,
            token: token.to_string(),
            client_name: client_name.to_string(),
        },
    };
    serde_json::to_string(&hello).unwrap_or_default()
}

/// Read a server's reply to a `Hello`.
pub fn classify(frame: &str) -> Probe {
    match serde_json::from_str::<Event>(frame) {
        Ok(Event::Welcome {
            protocol,
            host_name,
            capabilities,
        }) => {
            // The fields the UI wants beyond capabilities; absent from an older server.
            let v: Value = serde_json::from_str(frame).unwrap_or(Value::Null);
            let strings = |key: &str| -> Vec<String> {
                v[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|s| s.as_str().map(str::to_string))
                    .collect()
            };
            Probe::Welcome(PeerInfo {
                host_name,
                protocol,
                capabilities,
                os: v["os"].as_str().map(str::to_string),
                agent_kinds: strings("agentKinds"),
                repos: strings("repos"),
            })
        }
        Ok(Event::Refused { .. }) => Probe::Refused,
        _ => Probe::Silent,
    }
}

/// Probe `address` with `token` (use [`NO_TOKEN`] to only ask whether a trace is there).
pub fn probe(prober: &dyn Prober, address: &str, token: &str, client_name: &str) -> Probe {
    match prober.exchange(address, &hello_frame(token, client_name)) {
        Ok(frame) => classify(&frame),
        Err(_) => Probe::Silent,
    }
}
