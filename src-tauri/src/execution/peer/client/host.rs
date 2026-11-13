//! A paired peer as an [`AgentHost`]: starting an agent asks that machine's trace
//! to start it in one of its repos, and rejoining attaches to the one a session
//! record names.

use std::sync::Arc;

use tauri::AppHandle;

use super::connect::Peer;
use super::link::Connector;
use super::live;
use super::session::Plan;
use crate::execution::peer::capabilities::SERVED_FEATURES;
use crate::execution::{AgentHost, Capabilities, HostError, LiveSession, SpawnSpec};

pub struct PeerHost {
    connector: Arc<dyn Connector>,
    peer: Peer,
    /// The peer's repo name.
    repo: String,
    /// The peer's id for the session, once it has one.
    remote_id: Option<String>,
    title: String,
}

impl PeerHost {
    pub fn new(
        connector: Arc<dyn Connector>,
        peer: Peer,
        repo: String,
        remote_id: Option<String>,
        title: String,
    ) -> Self {
        PeerHost {
            connector,
            peer,
            repo,
            remote_id,
            title,
        }
    }
}

impl AgentHost for PeerHost {
    /// What the server gives: the screen and its turns. No chat, files,
    /// transcript, shell or tests until the protocol carries them.
    fn capabilities(&self) -> Capabilities {
        SERVED_FEATURES
    }

    fn spawn(&self, app: &AppHandle, spec: SpawnSpec) -> Result<LiveSession, HostError> {
        let plan = Plan {
            peer: self.peer.clone(),
            repo: self.repo.clone(),
            remote_id: self.remote_id.clone(),
            cli: spec.cli,
            prompt: spec.prompt,
            title: Some(self.title.clone()).filter(|t| !t.is_empty()),
            cols: spec.cols,
            rows: spec.rows,
        };
        Ok(live::start(
            app.clone(),
            self.connector.clone(),
            spec.workspace_id,
            plan,
        ))
    }
}
