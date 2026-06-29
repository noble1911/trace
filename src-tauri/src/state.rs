//! Shared application state. Held by Tauri via `.manage()` and accessed from
//! commands and the PTY pump thread.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;

use parking_lot::{Mutex, RwLock};

use crate::claude::pty::PtySession;
use crate::claude::render_bridge::RenderBridge;
use crate::jira::JiraConnection;

/// Rolling raw-output history for one workspace's PTY. The renderer's copy of
/// the byte stream dies with every page reload (dev hot-reload, Cmd+R); this
/// backend copy lets a fresh terminal replay the scrollback. Chunks carry a
/// monotonic `seq` that also rides on each `pty-output` event, so the frontend
/// can replay a snapshot and resume from exactly the next live chunk.
pub struct OutputHistory {
    pub seq: u64,
    /// (seq, base64 chunk), oldest first. Evicted from the front past the cap.
    pub chunks: VecDeque<(u64, String)>,
    /// Sum of encoded chunk lengths, for the eviction budget.
    pub bytes: usize,
    /// PTY dimensions the history was produced at — replay at the same size
    /// is deterministic; replay at another width garbles TUI redraws.
    pub cols: u16,
    pub rows: u16,
}

/// Per-workspace history budget (~2 MiB of encoded bytes ≈ 1.5 MiB raw).
pub const OUTPUT_HISTORY_CAP: usize = 2 * 1024 * 1024;

#[derive(Default)]
pub struct AppState {
    /// The active Jira connection (site/email/token). `None` until the user
    /// logs in. The token lives here and in the keychain — never sent to the UI.
    pub jira: RwLock<Option<JiraConnection>>,
    /// Live interactive Claude sessions, keyed by issue key.
    pub pty_sessions: Mutex<HashMap<String, PtySession>>,
    /// Child PIDs for running agents (for SIGINT/stop), keyed by issue key.
    pub child_pids: Mutex<HashMap<String, u32>>,
    /// Rolling PTY output per workspace (see `OutputHistory`). Reset on spawn,
    /// kept after exit so a reload can still show the final transcript.
    pub output_history: Mutex<HashMap<String, OutputHistory>>,
    /// Workspace ids with a start in flight. Spawning involves slow work (worktree
    /// creation), so two quick start requests could otherwise both pass the
    /// "already running?" check and spawn duplicate agents into one workspace —
    /// duplicated terminal output and a `--session-id`/`--resume` collision. This
    /// reserves the id for the duration of a start so the second request no-ops.
    pub starting: Mutex<HashSet<String>>,
    /// Loopback HTML bridge (port + token), started lazily on the first agent
    /// spawn and shared by all agents. `OnceLock` so it binds once and lives for
    /// the app's lifetime. See `claude::render_bridge`.
    pub render_bridge: OnceLock<RenderBridge>,
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
