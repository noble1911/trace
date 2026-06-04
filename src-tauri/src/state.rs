//! Shared application state. Held by Tauri via `.manage()` and accessed from
//! commands and the PTY pump thread.

use std::collections::{HashMap, HashSet};

use parking_lot::{Mutex, RwLock};

use crate::claude::pty::PtySession;
use crate::jira::JiraConnection;

#[derive(Default)]
pub struct AppState {
    /// The active Jira connection (site/email/token). `None` until the user
    /// logs in. The token lives here and in the keychain — never sent to the UI.
    pub jira: RwLock<Option<JiraConnection>>,
    /// Local git repo agents run in (worktrees are created under it).
    pub repo_path: RwLock<Option<String>>,
    /// Live interactive Claude sessions, keyed by issue key.
    pub pty_sessions: Mutex<HashMap<String, PtySession>>,
    /// Child PIDs for running agents (for SIGINT/stop), keyed by issue key.
    pub child_pids: Mutex<HashMap<String, u32>>,
    /// Workspace ids with a start in flight. Spawning involves slow work (worktree
    /// creation), so two quick start requests could otherwise both pass the
    /// "already running?" check and spawn duplicate agents into one workspace —
    /// duplicated terminal output and a `--session-id`/`--resume` collision. This
    /// reserves the id for the duration of a start so the second request no-ops.
    pub starting: Mutex<HashSet<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}

/// RAII reservation of a workspace id while its agent is starting. Drops the
/// reservation on scope exit, so every early-return path in a start command is
/// covered. `acquire` returns `None` when a start is already in flight.
pub struct StartGuard<'a> {
    state: &'a AppState,
    id: String,
}

impl<'a> StartGuard<'a> {
    pub fn acquire(state: &'a AppState, id: &str) -> Option<Self> {
        if state.starting.lock().insert(id.to_string()) {
            Some(Self { state, id: id.to_string() })
        } else {
            None
        }
    }
}

impl Drop for StartGuard<'_> {
    fn drop(&mut self) {
        self.state.starting.lock().remove(&self.id);
    }
}
