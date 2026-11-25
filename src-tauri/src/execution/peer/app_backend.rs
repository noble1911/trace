//! This trace as the peer server's `Backend`: its repos, its agents, its PTYs.
//! A peer's `Spawn` makes an ordinary session (`commands::session`) and starts it
//! the way the New session dialog does, so worktrees, hooks, tools and
//! transcripts all behave as they do for the user at this machine.

use tauri::{AppHandle, Emitter, Manager};

use super::backend::{plan_replay, Backend, Replay, Requester, SpawnRequest};
use super::capabilities::{summarize, RepoSummary, ServerCapabilities};
use super::protocol::RemoteSession;
use crate::commands::session_origin::CreatedBy;
use crate::state::AppState;

/// Tells this trace's renderer about a session it didn't make itself.
pub const SESSION_ADDED: &str = "session-added";

pub struct AppBackend {
    app: AppHandle,
    /// This machine's name on the tailnet.
    name: String,
}

impl AppBackend {
    pub fn new(app: AppHandle, name: String) -> Self {
        AppBackend { app, name }
    }

    /// Whether the window that runs agent tools is there and has registered them.
    fn window_open(&self) -> bool {
        self.app.get_webview_window("main").is_some()
            && !crate::agent_tools::defs(&self.app).is_empty()
    }

    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }
}

/// Each configured repo as a client names it, with the folder it is at. The
/// folder stays here: only the summary is ever sent.
fn repos() -> Vec<(RepoSummary, String)> {
    let paths = crate::commands::repos::all_repos();
    let all = crate::repo_catalog::details(&paths)
        .into_iter()
        .filter(|d| d.exists)
        .map(|d| {
            let full = d.remote.as_ref().map(|r| (r.host.clone(), r.full_name()));
            let summary = summarize(
                &d.path,
                full.as_ref().map(|(h, f)| (h.as_str(), f.as_str())),
            );
            (summary, d.path)
        })
        .collect();
    super::capabilities::drop_ambiguous(all)
}

/// Who started a session from another computer: its tailnet name, else what
/// it called itself (trace's own `trace (os)` placeholder says nothing, so not that).
fn started_by(from: &Requester) -> CreatedBy {
    let status = super::tailscale::status();
    let label = status
        .device_at(&from.address)
        .map(str::to_string)
        .unwrap_or_else(|| {
            if from.name.starts_with("trace (") {
                String::new()
            } else {
                from.name.clone()
            }
        });
    CreatedBy::Peer { label }
}

/// The agent kinds this machine can start.
fn agents() -> Vec<String> {
    ["claude", "codex"]
        .into_iter()
        .filter(|cli| crate::claude::discovery::find_cli_with_env(cli, None).is_some())
        .map(str::to_string)
        .collect()
}

impl Backend for AppBackend {
    fn token(&self) -> Result<String, String> {
        super::pairing::server_token()
    }

    fn capabilities(&self) -> ServerCapabilities {
        let repos = repos().into_iter().map(|(summary, _)| summary).collect();
        let mut caps = ServerCapabilities::new(&self.name, agents(), repos);
        // Agent tools run in this trace's window: with it closed, no agent started
        // here could use them, and a client should know before it asks.
        caps.features.agent_tools = self.window_open();
        caps
    }

    fn sessions(&self) -> Vec<RemoteSession> {
        let titles = crate::commands::session::load();
        let mut ids: Vec<String> = self
            .state()
            .pty_sessions
            .lock()
            .keys()
            .filter(|id| super::backend::is_served(id))
            .cloned()
            .collect();
        ids.sort();
        ids.into_iter()
            .map(|id| RemoteSession {
                title: titles.iter().find(|s| s.id == id).map(|s| s.title.clone()),
                workspace_id: id,
                busy: false,
            })
            .collect()
    }

    fn spawn(&self, request: SpawnRequest) -> Result<String, String> {
        if !self.window_open() {
            return Err("This trace's window is closed: its agents need it open.".to_string());
        }
        if !agents().contains(&request.cli) {
            return Err(format!("This trace can't run {}.", request.cli));
        }
        let (_, path) = repos()
            .into_iter()
            .find(|(summary, _)| summary.name == request.repo)
            .ok_or("That repo isn't on this trace.")?;
        let title = request.title.unwrap_or_default();
        let session = crate::commands::session::create_session(
            title,
            request.cli,
            None,
            Some(path),
            None,
            None,
            Some(started_by(&request.from)),
            None,
        )?;
        eprintln!("trace: peer server: spawning session {}", session.id);
        let started = crate::commands::session::start_session(
            self.app.clone(),
            self.state(),
            session.id.clone(),
            request.cols,
            request.rows,
            None,
            request.prompt,
            // A peer attaches to a screen; a chat agent has none to share.
            Some("terminal".to_string()),
        );
        // This trace's own window lists it either way (it's saved), and adopts
        // the PTY if one started, so the user here sees and can drive it too.
        let _ = self.app.emit(SESSION_ADDED, &session);
        started?;
        super::publish::run_state(&self.app, &session.id, true, false);
        Ok(session.id)
    }

    fn replay(&self, workspace_id: &str, from_seq: u64) -> Option<Replay> {
        let state = self.state();
        let histories = state.output_history.lock();
        let h = histories.get(workspace_id)?;
        Some(plan_replay(&h.chunks, h.seq, h.cols, h.rows, from_seq))
    }

    fn input(&self, workspace_id: &str, data: &[u8]) -> Result<(), String> {
        let state = self.state();
        let mut sessions = state.pty_sessions.lock();
        let session = sessions
            .get_mut(workspace_id)
            .ok_or("No running agent for that.")?;
        session
            .write_input(data)
            .map_err(|e| format!("Couldn't write to the agent: {e}"))
    }

    fn resize(&self, workspace_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        crate::commands::agent::resize_agent(self.state(), workspace_id.to_string(), cols, rows)
            .map(|_| ())
    }

    fn stop(&self, workspace_id: &str) -> Result<(), String> {
        crate::commands::agent::stop_agent(self.state(), workspace_id.to_string())
    }
}
