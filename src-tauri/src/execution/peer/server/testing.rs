//! A `Backend` that does nothing real, for testing the server and its handler.

use parking_lot::Mutex;

use crate::execution::peer::backend::{Backend, Replay, SpawnRequest};
use crate::execution::peer::capabilities::{RepoSummary, ServerCapabilities};
use crate::execution::peer::protocol::RemoteSession;

/// 64 hex digits, the shape `pairing` makes.
pub const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
/// The right shape, the wrong value.
pub const WRONG_TOKEN: &str = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

#[derive(Default)]
pub struct FakeBackend {
    /// What happened, as `verb workspace detail`.
    pub calls: Mutex<Vec<String>>,
    /// Set by [`FakeBackend::rotate`]; the server's token is TOKEN until then.
    pub rotated: Mutex<Option<String>>,
}

impl FakeBackend {
    /// As `peer_rotate_token` does: from now on the token is another one.
    pub fn rotate(&self) {
        *self.rotated.lock() = Some(WRONG_TOKEN.to_string());
    }

    fn note(&self, line: String) {
        self.calls.lock().push(line);
    }

    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().clone()
    }
}

impl Backend for FakeBackend {
    fn token(&self) -> Result<String, String> {
        Ok(self
            .rotated
            .lock()
            .clone()
            .unwrap_or_else(|| TOKEN.to_string()))
    }

    fn capabilities(&self) -> ServerCapabilities {
        ServerCapabilities::new(
            "test-box",
            vec!["claude".into()],
            vec![RepoSummary {
                name: "acme/widgets".into(),
                remote: Some("github.com/acme/widgets".into()),
            }],
        )
    }

    fn sessions(&self) -> Vec<RemoteSession> {
        self.note("list".into());
        vec![RemoteSession {
            workspace_id: "ws1".into(),
            title: Some("Fix it".into()),
            busy: false,
        }]
    }

    fn spawn(&self, r: SpawnRequest) -> Result<String, String> {
        self.note(format!("spawn {} {} {:?}", r.repo, r.cli, r.prompt));
        if r.repo == "acme/widgets" {
            Ok("ws-new".into())
        } else {
            Err("That repo isn't on this trace.".into())
        }
    }

    fn replay(&self, workspace_id: &str, from_seq: u64) -> Option<Replay> {
        self.note(format!("replay {workspace_id} {from_seq}"));
        (workspace_id == "ws1").then(|| Replay {
            reset: false,
            cols: 100,
            rows: 30,
            chunks: vec![(1, "YQ==".into()), (2, "Yg==".into())],
            last_seq: 2,
        })
    }

    fn input(&self, workspace_id: &str, data: &[u8]) -> Result<(), String> {
        self.note(format!(
            "input {workspace_id} {}",
            String::from_utf8_lossy(data)
        ));
        Ok(())
    }

    fn resize(&self, workspace_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.note(format!("resize {workspace_id} {cols}x{rows}"));
        Ok(())
    }

    fn stop(&self, workspace_id: &str) -> Result<(), String> {
        self.note(format!("stop {workspace_id}"));
        Ok(())
    }
}
