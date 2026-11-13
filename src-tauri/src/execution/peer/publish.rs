//! The three places agents report to the renderer (`pty-output`,
//! `agent-run-state`, `agent-turn`) call these too, so attached peers get the
//! same stream. Each is a no-op while no peer is connected.

use tauri::{AppHandle, Manager};

use super::protocol::Event;
use crate::state::AppState;

fn send(app: &AppHandle, build: impl FnOnce() -> Event) {
    if let Some(state) = app.try_state::<AppState>() {
        if !state.peer_hub.is_idle() {
            state.peer_hub.publish(&build());
        }
    }
}

/// A chunk of terminal output, already base64.
pub fn output(app: &AppHandle, workspace_id: &str, seq: u64, data: &str) {
    send(app, || Event::Output {
        workspace_id: workspace_id.to_string(),
        seq,
        data: data.to_string(),
    });
}

pub fn run_state(app: &AppHandle, workspace_id: &str, running: bool, exited: bool) {
    send(app, || Event::RunState {
        workspace_id: workspace_id.to_string(),
        running,
        exited,
    });
}

/// A turn ended or needs a person: the renderer's `agent-turn` payload, which is
/// the protocol's `turn` event without its `type`.
pub fn turn(app: &AppHandle, payload: &impl serde::Serialize) {
    send(app, || {
        let mut value = serde_json::to_value(payload).unwrap_or_default();
        value["type"] = "turn".into();
        serde_json::from_value(value).unwrap_or_else(|e| Event::Error {
            id: None,
            message: format!("A turn couldn't be sent: {e}"),
        })
    });
}
