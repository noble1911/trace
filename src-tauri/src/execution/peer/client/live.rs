//! A remote agent as an [`AgentSession`]: one thread runs the flow in `session`
//! and reports to this trace's history and events, so the terminal can't tell
//! the agent is on another machine. Dropping the session lets go of the line
//! and leaves the agent running there; only `stop` ends it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;

use tauri::AppHandle;

use super::link::Connector;
use super::session::{run, Cmd, Plan, Sink};
use crate::claude::pty_output;
use crate::claude::remote_turn::{self, RemoteTurn};
use crate::execution::peer::protocol::Event;
use crate::execution::{AgentSession, LiveSession};

/// Runs' ids, above the sandbox's, so no two kinds meet.
static NEXT_RUN: AtomicU64 = AtomicU64::new(1 << 41);

struct PeerSession {
    tx: Sender<Cmd>,
    run: u64,
}

impl AgentSession for PeerSession {
    fn write_input(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.tx
            .send(Cmd::Input(data.to_vec()))
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::BrokenPipe))
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.tx
            .send(Cmd::Resize(cols, rows))
            .map_err(|_| "The session on the peer has ended.".to_string())
    }

    /// Not a process on this machine.
    fn pid(&self) -> Option<u32> {
        None
    }

    fn run_id(&self) -> Option<u64> {
        Some(self.run)
    }

    fn stop(&mut self) {
        let _ = self.tx.send(Cmd::Stop);
    }

    fn can_detach(&self) -> bool {
        true
    }
}

/// Reports a session's flow to the app.
struct AppSink {
    app: AppHandle,
    workspace_id: String,
}

impl Sink for AppSink {
    fn begin(&self, cols: u16, rows: u16) {
        pty_output::begin_run(&self.app, &self.workspace_id, cols, rows);
    }

    fn output(&self, bytes: &[u8]) -> bool {
        pty_output::record(&self.app, &self.workspace_id, bytes)
    }

    fn say(&self, line: &str) {
        pty_output::record(
            &self.app,
            &self.workspace_id,
            format!("\x1b[2m{line}\x1b[0m\r\n").as_bytes(),
        );
    }

    fn fail(&self, line: &str) {
        eprintln!("trace: peer client: {}: {}", self.workspace_id, short(line));
        pty_output::record(
            &self.app,
            &self.workspace_id,
            format!("\x1b[31m{line}\x1b[0m\r\n").as_bytes(),
        );
    }

    fn turn(&self, turn: &Event) {
        if let Event::Turn {
            event,
            background_tasks,
            notification_type,
            message,
            last_message,
            ..
        } = turn
        {
            remote_turn::emit(
                &self.app,
                &self.workspace_id,
                RemoteTurn {
                    event,
                    background_tasks: *background_tasks,
                    notification_type: notification_type.as_deref(),
                    message: message.as_deref(),
                    last_message: last_message.as_deref(),
                },
            );
        }
    }

    fn spawned(&self, remote_id: &str) {
        remember(&self.workspace_id, Some(remote_id));
    }

    fn forget(&self) {
        remember(&self.workspace_id, None);
    }
}

/// A log line's worth of a message: no more than a sentence.
fn short(line: &str) -> String {
    line.chars().take(120).collect()
}

fn remember(workspace_id: &str, remote_id: Option<&str>) {
    if let Err(e) = crate::commands::session_peer::set_peer_remote(workspace_id, remote_id) {
        eprintln!("trace: peer client: couldn't save the peer session id: {e}");
    }
}

/// Start the session's thread and hand back its handle at once: the terminal
/// shows the steps as they happen.
pub fn start(
    app: AppHandle,
    connector: Arc<dyn Connector>,
    workspace_id: String,
    plan: Plan,
) -> LiveSession {
    let (tx, rx) = mpsc::channel();
    let run_id = NEXT_RUN.fetch_add(1, Ordering::Relaxed);
    std::thread::spawn(move || {
        let sink = AppSink {
            app: app.clone(),
            workspace_id: workspace_id.clone(),
        };
        let ended = run(&*connector, &plan, &sink, &rx);
        eprintln!("trace: peer client: {workspace_id} ended: {ended:?}");
        // Whatever ended it, this run is over. A drop leaves the agent on the peer.
        pty_output::end_run(&app, &workspace_id, Some(run_id));
    });
    Box::new(PeerSession { tx, run: run_id })
}
