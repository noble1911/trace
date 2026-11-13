//! A scripted server for the client's tests: no socket, no listener. It answers
//! requests the way the real server does (hello, spawn, attach) and lets a test
//! push output or cut the line.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use parking_lot::Mutex;

use super::connect::Peer;
use super::link::{Connector, Link, LinkError};
use crate::execution::peer::capabilities::{RepoSummary, ServerCapabilities};
use crate::execution::peer::protocol::{Event, RemoteSession, Request};

pub const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

#[derive(Default)]
pub struct Script {
    /// Every request the client sent, as written to the wire.
    pub sent: Vec<Request>,
    inbox: VecDeque<Event>,
    /// Cut the line: the next `recv` fails.
    pub cut: bool,
    /// The server refuses hello with this reason.
    pub refuse: Option<String>,
    /// Nobody is listening.
    pub down: bool,
    /// Sessions the server says it runs.
    pub sessions: Vec<String>,
    /// What `spawn` answers with; None answers with an error.
    pub spawns_as: Option<String>,
    pub caps: Option<ServerCapabilities>,
    /// Sent right after the attach is answered: the replay and what follows.
    pub after_attach: Vec<Event>,
}

#[derive(Clone, Default)]
pub struct FakeServer(pub Arc<Mutex<Script>>);

pub fn caps(window_open: bool) -> ServerCapabilities {
    let mut caps = ServerCapabilities::new(
        "box",
        vec!["claude".into()],
        vec![RepoSummary {
            name: "acme/widgets".into(),
            remote: None,
        }],
    );
    caps.features.agent_tools = window_open;
    caps
}

pub fn peer() -> Peer {
    Peer {
        id: "p1".into(),
        name: "box".into(),
        address: "100.64.0.2:47821".into(),
        token: TOKEN.into(),
    }
}

pub fn b64(text: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(text)
}

impl FakeServer {
    pub fn new() -> Self {
        let server = FakeServer::default();
        {
            let mut s = server.0.lock();
            s.spawns_as = Some("ws-remote".into());
            s.caps = Some(caps(true));
        }
        server
    }

    /// Queue an event to arrive once the client has attached.
    pub fn on_attach(&self, event: Event) {
        self.0.lock().after_attach.extend([event]);
    }

    pub fn sent(&self) -> Vec<Request> {
        self.0.lock().sent.clone()
    }
}

struct FakeLink(FakeServer);

impl Connector for FakeServer {
    fn connect(&self, _address: &str) -> Result<Box<dyn Link>, LinkError> {
        if self.0.lock().down {
            return Err(LinkError::Unreachable("connection timed out".into()));
        }
        Ok(Box::new(FakeLink(self.clone())))
    }
}

impl Link for FakeLink {
    fn send(&mut self, request: &Request, id: Option<u64>) -> Result<(), LinkError> {
        let mut s = self.0 .0.lock();
        if s.cut {
            return Err(LinkError::Lost("broken pipe".into()));
        }
        s.sent.push(request.clone());
        let reply = match request {
            Request::Hello { .. } => match s.refuse.clone() {
                Some(reason) => Some(Event::Refused { reason }),
                None => Some(Event::Welcome {
                    capabilities: s.caps.clone().unwrap_or_default(),
                }),
            },
            Request::List => Some(Event::Sessions {
                id,
                sessions: s
                    .sessions
                    .iter()
                    .map(|w| RemoteSession {
                        workspace_id: w.clone(),
                        title: None,
                        busy: false,
                    })
                    .collect(),
            }),
            Request::Spawn { .. } => Some(match s.spawns_as.clone() {
                Some(workspace_id) => Event::Spawned { id, workspace_id },
                None => Event::Error {
                    id,
                    message: "That repo isn't on this trace.".into(),
                },
            }),
            Request::Attach { workspace_id, .. } => Some(Event::Attached {
                id,
                workspace_id: workspace_id.clone(),
                reset: false,
                cols: 100,
                rows: 30,
            }),
            _ => None,
        };
        s.inbox.extend(reply);
        if matches!(request, Request::Attach { .. }) {
            let later = std::mem::take(&mut s.after_attach);
            s.inbox.extend(later);
        }
        Ok(())
    }

    fn recv(&mut self, wait: Duration) -> Result<Option<Event>, LinkError> {
        let mut s = self.0 .0.lock();
        if s.cut {
            return Err(LinkError::Lost("connection reset".into()));
        }
        if let Some(event) = s.inbox.pop_front() {
            return Ok(Some(event));
        }
        drop(s);
        std::thread::sleep(wait.min(Duration::from_millis(2)));
        Ok(None)
    }

    fn close(&mut self) {}
}
