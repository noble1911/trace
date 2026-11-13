//! A turn reported by an agent on a peer, handed to the renderer as the
//! `agent-turn` its own hooks would have raised, so the inbox and the board
//! card react to a remote agent as to a local one.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AgentTurn<'a> {
    workspace_id: &'a str,
    event: &'a str,
    background_tasks: u32,
    notification_type: Option<&'a str>,
    message: Option<&'a str>,
    last_message: Option<&'a str>,
}

pub struct RemoteTurn<'a> {
    pub event: &'a str,
    pub background_tasks: u32,
    pub notification_type: Option<&'a str>,
    pub message: Option<&'a str>,
    pub last_message: Option<&'a str>,
}

pub fn emit(app: &AppHandle, workspace_id: &str, t: RemoteTurn<'_>) {
    let _ = app.emit(
        "agent-turn",
        AgentTurn {
            workspace_id,
            event: t.event,
            background_tasks: t.background_tasks,
            notification_type: t.notification_type,
            message: t.message,
            last_message: t.last_message,
        },
    );
}
