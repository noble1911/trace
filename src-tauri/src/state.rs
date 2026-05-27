//! Shared application state. Held by Tauri via `.manage()` and accessed from
//! commands and the PTY pump thread.

use std::collections::HashMap;

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
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }
}
