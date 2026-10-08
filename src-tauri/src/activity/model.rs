//! The activity event shape — shared by the log, the IPC commands, and every
//! producer. Mirrored in `src/domains/activity/types.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// What happened. Kebab-case on the wire (`agent-needs-input`). Unknown kinds
/// (a log written by a newer build) read back as `Other` rather than failing.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ActivityKind {
    Transition,
    AgentStart,
    PrRaised,
    PrMerged,
    SessionCreated,
    /// Claude is blocked on a human (usually a permission prompt).
    AgentNeedsInput,
    /// An agent's turn ended; `data.backgroundTasks` says if work is still going.
    AgentTurnEnd,
    /// An agent's process exited (stopped, finished, or crashed).
    AgentExit,
    ScheduleRunStarted,
    ScheduleRunSucceeded,
    ScheduleRunFailed,
    /// A watched PR's CI went red.
    ChecksFailed,
    /// A watched PR's CI went green after running.
    ChecksPassed,
    #[serde(other)]
    Other,
}

/// Who caused an event. Consumers key off this — an automated reader must never
/// wake on its own actions (`Orchestrator`), or it feeds back into itself.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Actor {
    /// The person at the keyboard. The default, so pre-actor events (imported
    /// from the old renderer-only feed) read as theirs.
    #[default]
    User,
    Orchestrator,
    Agent,
    Schedule,
    System,
}

/// An event as a producer submits it; [`super::record`] stamps the id and time.
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivityInput {
    pub kind: ActivityKind,
    #[serde(default)]
    pub actor: Actor,
    #[serde(default)]
    pub issue_key: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Display name when the event isn't about an issue (a session's title).
    #[serde(default)]
    pub subject: Option<String>,
    /// Human description shown after the key chip, e.g. "→ In Review".
    pub title: String,
    /// Kind-specific structured detail, for consumers that reason about events.
    #[serde(default)]
    pub data: Value,
}

/// One persisted event.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: String,
    /// Epoch ms.
    pub at: i64,
    pub kind: ActivityKind,
    #[serde(default)]
    pub actor: Actor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub title: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub data: Value,
}

impl ActivityInput {
    /// A bare input — producers fill the optional fields with struct update syntax.
    pub fn new(kind: ActivityKind, actor: Actor, title: impl Into<String>) -> Self {
        Self {
            kind,
            actor,
            issue_key: None,
            workspace_id: None,
            subject: None,
            title: title.into(),
            data: Value::Null,
        }
    }
}

impl ActivityEvent {
    /// Stamp an input with a fresh id and the current time.
    pub fn stamp(input: ActivityInput) -> Self {
        Self {
            id: crate::helpers::new_id(),
            at: chrono::Utc::now().timestamp_millis(),
            kind: input.kind,
            actor: input.actor,
            issue_key: input.issue_key,
            workspace_id: input.workspace_id,
            subject: input.subject,
            title: input.title,
            data: input.data,
        }
    }
}
