//! Where an agent terminal's bytes go, whichever host runs it: the rolling
//! history a reloaded terminal replays, the `pty-output` event, and the
//! `agent-run-state` + activity entry when the run ends. A local PTY
//! (`claude::pty`) and a sandbox session (`execution::sandbox`) both report
//! through here, so the renderer can't tell them apart.

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::pty_exit;
use crate::state::{AppState, OutputHistory, OUTPUT_HISTORY_CAP};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PtyOutput {
    /// The owning issue/workspace — the frontend filters output by this.
    workspace_id: String,
    /// Base64-encoded raw PTY bytes (preserves ANSI + multibyte splits).
    data: String,
    /// Monotonic chunk counter, matching the backend output history — lets a
    /// freshly-created terminal replay a snapshot then skip already-replayed
    /// live chunks.
    seq: u64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RunState {
    workspace_id: String,
    running: bool,
    /// The process ended on its own (it quit, or crashed) rather than being
    /// stopped: the renderer offers to restart it.
    exited: bool,
}

/// Start a fresh history for a new run. The new process repaints from scratch,
/// so the previous run's bytes are no longer a valid replay.
pub fn begin_run(app: &AppHandle, workspace_id: &str, cols: u16, rows: u16) {
    if let Some(state) = app.try_state::<AppState>() {
        state.output_history.lock().insert(
            workspace_id.to_string(),
            OutputHistory {
                seq: 0,
                chunks: std::collections::VecDeque::new(),
                bytes: 0,
                cols,
                rows,
            },
        );
    }
}

/// Record a chunk and send it to the renderer. False once the workspace's history
/// is gone (the session was deleted), which tells the pump to stop.
pub fn record(app: &AppHandle, workspace_id: &str, bytes: &[u8]) -> bool {
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    // Record into the rolling history first, so any snapshot taken after this
    // emit is a superset of what the event stream delivered (the seq handoff
    // depends on it).
    let seq = match app.try_state::<AppState>() {
        Some(state) => {
            let mut histories = state.output_history.lock();
            let Some(h) = histories.get_mut(workspace_id) else {
                return false;
            };
            h.seq += 1;
            h.bytes += encoded.len();
            h.chunks.push_back((h.seq, encoded.clone()));
            while h.bytes > OUTPUT_HISTORY_CAP {
                if let Some((_, dropped)) = h.chunks.pop_front() {
                    h.bytes -= dropped.len();
                } else {
                    break;
                }
            }
            h.seq
        }
        None => 0,
    };
    crate::execution::peer::publish::output(app, workspace_id, seq, &encoded);
    let _ = app.emit(
        "pty-output",
        PtyOutput {
            workspace_id: workspace_id.to_string(),
            data: encoded,
            seq,
        },
    );
    true
}

/// The run is over: drop its bookkeeping and tell the renderer. `run` is this
/// run's id (`AgentSession::run_id`), so a newer run under the id is left alone.
pub fn end_run(app: &AppHandle, workspace_id: &str, run: Option<u64>) {
    crate::interrupted::record_exit(app, workspace_id);
    // A stop takes the session out of state before ending it, so finding it
    // still here means nobody asked the process to end.
    // (On Windows `watch_for_exit` closes it first, and notes that it did.)
    // Only this run's session: a quick restart may already have put a new one there.
    let exited = pty_exit::take_session(app, workspace_id, run).is_some()
        | pty_exit::take_natural_exit(workspace_id);
    crate::execution::peer::publish::run_state(app, workspace_id, false, exited);
    let _ = app.emit(
        "agent-run-state",
        RunState {
            workspace_id: workspace_id.to_string(),
            running: false,
            exited,
        },
    );
    crate::activity::record_agent(
        app,
        workspace_id,
        crate::activity::ActivityKind::AgentExit,
        "session ended",
        serde_json::Value::Null,
    );
}
