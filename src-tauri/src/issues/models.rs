//! Provider-agnostic board shapes shared by every issue tracker (Jira, Pylon).
//!
//! These are the frontend-facing models: each provider parses its own raw API
//! payloads into these structs. Providers parse from `serde_json::Value` rather
//! than deriving full Deserialize structs because their payloads are large and
//! version-variable — we pluck only what the board needs and stay resilient to
//! extra/missing fields.

use serde::Serialize;

/// The authenticated user of the active provider.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueUser {
    /// Provider-specific user id (Jira accountId, Pylon user id).
    pub account_id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

/// A selectable board. Pylon has no board entity, so it exposes virtual boards
/// (e.g. "Open issues") — the id is an opaque string across providers.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardSummary {
    pub id: String,
    pub name: String,
    pub board_type: String,
}

/// One status a board column maps to. A column can hold several (e.g. an
/// "In Progress" column covering both In Progress and Blocked), so each carries
/// its own id+name for the per-status drop zones.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColumnStatus {
    pub id: String,
    pub name: String,
    /// Status category key: `new` | `indeterminate` | `done`. Lets the frontend
    /// tell "work starts here" columns from to-do/done ones without hardcoding
    /// column names. (Jira's statusCategory; mapped from the state on Pylon.)
    pub category: String,
}

/// A board column and the set of status ids that map into it, in board order.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    pub name: String,
    pub statuses: Vec<ColumnStatus>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Assignee {
    pub account_id: String,
    pub display_name: String,
    pub initial: String,
    pub avatar_url: Option<String>,
}

/// A board card = one issue from the active provider.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    /// Provider-native id. Jira: numeric id (dev-status lookups). Pylon: issue id.
    pub id: String,
    /// Display key (Jira `TRACE-12`, Pylon `#123`).
    pub key: String,
    pub summary: String,
    pub status_id: String,
    pub status_name: String,
    /// Status category key: `new` | `indeterminate` | `done`.
    pub status_category: String,
    /// Mapped priority code for the card's accent bar: p0..p3.
    pub priority: String,
    pub issue_type: String,
    pub labels: Vec<String>,
    pub assignee: Option<Assignee>,
    pub description: Option<String>,
    /// Grouping label for display (Jira epic; unused on Pylon).
    pub epic: Option<String>,
    /// Epic issue key for the browse link (Jira only).
    pub epic_key: Option<String>,
    /// Jira's epic palette key ("color_1"…"color_14"); None otherwise, where the
    /// frontend falls back to a hashed hue.
    pub epic_color: Option<String>,
    pub reporter: Option<String>,
    /// Provider-native web URL for the issue, when the API carries one.
    pub browse_url: Option<String>,
}

/// Everything the board needs in one payload.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardData {
    pub board_id: String,
    pub board_name: String,
    pub sprint_name: Option<String>,
    pub columns: Vec<BoardColumn>,
    pub issues: Vec<Issue>,
}

/// A GitHub pull request linked to an issue. Only Jira exposes linked PRs (via
/// the dev-status integration); other providers return an empty list.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: String,
    pub url: String,
    /// `open` | `merged` | `declined` | `draft` (lower-cased for CSS class reuse).
    pub state: String,
    pub title: String,
}

/// One entry in an issue's discussion thread (Jira comment; Pylon customer
/// message or internal note), flattened to plain text by the provider parser.
/// Feeds the `{comments}` placeholder in the agent kickoff brief.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    /// Author display name (customer, teammate, or bot).
    pub author: String,
    /// Creation timestamp as the API carries it, when present.
    pub created: Option<String>,
    /// Internal note never shown to the customer (Pylon `is_private`). Always
    /// false on Jira — its comment endpoint carries no such flag.
    pub is_internal: bool,
    /// Plain-text body (ADF/HTML already flattened).
    pub body: String,
}

// ---- shared helpers for provider parsers ------------------------------------

/// First letter of a display name, upper-cased (for the avatar fallback).
pub fn initial_of(name: &str) -> String {
    name.chars()
        .next()
        .map(|c| c.to_ascii_uppercase().to_string())
        .unwrap_or_else(|| "?".to_string())
}
