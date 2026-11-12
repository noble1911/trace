//! The `JournalSink` each chat adapter writes to: it appends rows to the
//! workspace's journal (`store`), emits them and the agent's `SessionInfo` to
//! the renderer, and lets the registry and the interrupted-agents ledger know
//! when the agent ends, as a terminal agent's exit does.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::journal::{JournalBody, JournalRow};
use super::{store, JournalSink, SessionInfo};
use crate::state::AppState;

/// `agent-journal`'s payload (`JournalEvent` in types.ts).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JournalEvent<'a> {
    pub(super) workspace_id: &'a str,
    pub(super) rows: Vec<JournalRow>,
    /// The rows are the whole journal, replacing what the view holds: it was
    /// renumbered (`backfill`).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub(super) reset: bool,
}

/// `agent-session-info`'s payload (`SessionInfoEvent` in types.ts).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfoEvent<'a> {
    workspace_id: &'a str,
    info: SessionInfo,
}

pub(super) struct Sink {
    pub(super) app: AppHandle,
    pub(super) workspace_id: String,
    pub(super) path: PathBuf,
    pub(super) instance: u64,
    /// A third-party provider, which pins the model: stamped on every info.
    pub(super) provider: Option<String>,
}

impl JournalSink for Sink {
    fn row(&self, row: JournalRow) {
        // Streaming text changes with every token: only its final revision is
        // kept, or a long answer would be written out once per word.
        let streaming = matches!(&row.body, JournalBody::Message(m) if m.streaming);
        if !streaming {
            if let Err(e) = store::append(&self.path, &row) {
                eprintln!("trace: {e}");
            }
        }
        // Plan mode and task lists become the Plan tab's documents (`plans`).
        crate::plans::on_row(&self.app, &self.workspace_id, &row);
        // A chat asks for a human with a row, not the terminal's Notification
        // hook: a scheduled run waiting on one needs you (`schedule::completion`).
        if asks_for_human(&row) && self.workspace_id.starts_with(crate::schedule::RUN_PREFIX) {
            crate::schedule::completion::needs_input(&self.app, &self.workspace_id);
        }
        let event = JournalEvent {
            workspace_id: &self.workspace_id,
            rows: vec![row],
            reset: false,
        };
        let _ = self.app.emit("agent-journal", event);
    }

    fn info(&self, mut info: SessionInfo) {
        info.provider = self.provider.clone();
        let state = self.app.state::<AppState>();
        let was_working = state
            .chat_agents
            .info(&self.workspace_id)
            .is_some_and(|i| i.at_work());
        let info = state.chat_agents.note_info(&self.workspace_id, info);
        // What a resume after a quit needs to know: was it still at work. Not the
        // turn that ends because trace is going down: that one was cut off.
        let going_down = state
            .shutting_down
            .load(std::sync::atomic::Ordering::SeqCst);
        let now_working = info.at_work();
        if now_working != was_working && !going_down {
            crate::interrupted::record_busy(&self.workspace_id, now_working);
        }
        let event = SessionInfoEvent {
            workspace_id: &self.workspace_id,
            info,
        };
        let _ = self.app.emit("agent-session-info", event);
    }

    fn exited(&self, _reason: Option<String>) {
        // The reason is already a status row; the registry just lets go.
        let state = self.app.state::<AppState>();
        if !state.chat_agents.ended(&self.workspace_id, self.instance) {
            return;
        }
        // As a terminal agent's exit does (`claude::pty`).
        crate::interrupted::record_exit(&self.app, &self.workspace_id);
        let _ = self.app.emit(
            "agent-run-state",
            serde_json::json!({ "workspaceId": self.workspace_id, "running": false }),
        );
        crate::activity::record_agent(
            &self.app,
            &self.workspace_id,
            crate::activity::ActivityKind::AgentExit,
            "session ended",
            serde_json::Value::Null,
        );
    }
}

/// An approval or question still waiting on its answer.
fn asks_for_human(row: &JournalRow) -> bool {
    match &row.body {
        JournalBody::Approval(a) => a.resolution.is_none(),
        JournalBody::Question(q) => q.resolution.is_none(),
        _ => false,
    }
}
