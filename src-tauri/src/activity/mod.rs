//! The activity log: one structured, persisted stream of what trace, its agents,
//! and its schedules did. The Activity view renders it; anything that reacts to
//! the board (the buddy, future orchestrator triggers) consumes it.
//!
//! Every producer — renderer actions (via `commands::activity`), Claude hooks,
//! PTY exits, scheduled runs — funnels through [`record`], which persists the
//! event and broadcasts it as `activity-event`.

mod log;
mod model;

pub use log::{clear, import, list};
pub use model::{ActivityEvent, ActivityInput, ActivityKind, Actor};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::schedule::RUN_PREFIX;

/// The backend → renderer event carrying each new [`ActivityEvent`].
pub const EVENT: &str = "activity-event";

/// Persist an event and broadcast it. Persistence is best-effort: a failed write
/// still emits, so the live feed never misses an event the disk did.
pub fn record(app: &AppHandle, input: ActivityInput) -> ActivityEvent {
    let event = ActivityEvent::stamp(with_subject(input));
    let _ = log::append(&event);
    let _ = app.emit(EVENT, &event);
    event
}

/// Record an event about an agent's workspace — attributed to its issue or its
/// session. Shell terminals and scheduled runs are skipped: the former aren't
/// agents, the latter log at the run level (`schedule::activity`).
pub fn record_agent(app: &AppHandle, ws: &str, kind: ActivityKind, title: &str, data: Value) {
    if ws.starts_with("term:") || ws.starts_with(RUN_PREFIX) {
        return;
    }
    let input = ActivityInput {
        workspace_id: Some(ws.to_string()),
        data,
        ..ActivityInput::new(kind, Actor::Agent, title)
    };
    record(app, input);
}

/// Fill in who an event is about from its workspace, when the producer didn't
/// say: a scratch session (by title) or a board issue (the id *is* the key).
fn with_subject(mut input: ActivityInput) -> ActivityInput {
    if input.issue_key.is_some() || input.subject.is_some() {
        return input;
    }
    let Some(ws) = input.workspace_id.as_deref() else {
        return input;
    };
    if let Some(session) = crate::commands::session::owning_session(ws) {
        input.subject = Some(session.title);
    } else if looks_like_issue_key(ws) {
        input.issue_key = Some(ws.to_string());
    }
    input
}

/// Jira `ABC-123` or Pylon `#123` — so a torn-down session's uuid never poses
/// as an issue key.
fn looks_like_issue_key(id: &str) -> bool {
    if let Some(num) = id.strip_prefix('#') {
        return !num.is_empty() && num.chars().all(|c| c.is_ascii_digit());
    }
    let Some((project, num)) = id.rsplit_once('-') else {
        return false;
    };
    project.starts_with(|c: char| c.is_ascii_uppercase())
        && project
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !num.is_empty()
        && num.chars().all(|c| c.is_ascii_digit())
}

/// Clip free text (Claude's closing message, a notification) for `data` —
/// enough for a consumer to react to, without bloating the log.
pub fn clip(text: &str, max: usize) -> String {
    let t = text.trim();
    if t.chars().count() <= max {
        return t.to_string();
    }
    let mut out: String = t.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_keys_vs_session_ids() {
        assert!(looks_like_issue_key("TRACE-12"));
        assert!(looks_like_issue_key("PM2-7"));
        assert!(looks_like_issue_key("#123"));
        assert!(!looks_like_issue_key("3f2a9c1e-0b7d-4c55-9e1a-2b3c4d5e6f70"));
        assert!(!looks_like_issue_key("term:TRACE-12"));
        assert!(!looks_like_issue_key("#"));
    }

    #[test]
    fn clip_marks_truncation() {
        assert_eq!(clip("  short  ", 10), "short");
        assert_eq!(clip("abcdefghij", 5), "abcd…");
    }
}
