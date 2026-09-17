//! Claude conversation ids per workspace.
//!
//! The raw PTY byte stream gives no way to read back the id of a conversation
//! Claude generated, so trace pins one up front (`--session-id`) and persists the
//! workspace → id map, letting the next start `--resume` it. Shared by board
//! agents, exploratory sessions (and their companions) and scheduled runs.

use std::path::PathBuf;
use std::sync::Mutex;

use crate::helpers::{new_id, restrict_perms};

// We pin a Claude session id per Jira issue the first time the user starts a
// session on it, and persist the map across launches. Subsequent starts on the
// same issue pass `--resume <id>` so the conversation continues where it left
// off rather than starting fresh. Codex manages its own session state and is
// skipped here.

fn sessions_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("sessions.json")
}

/// Serializes every load→mutate→save cycle on `sessions.json`. Two agents
/// starting concurrently (the start guard is per-issue, not global) would
/// otherwise read the same snapshot and the second write would drop the
/// first one's mapping.
static SESSIONS_FILE_LOCK: Mutex<()> = Mutex::new(());

fn load_sessions() -> std::collections::HashMap<String, String> {
    std::fs::read_to_string(sessions_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_sessions(map: &std::collections::HashMap<String, String>) -> Result<(), String> {
    let path = sessions_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(map).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    restrict_perms(&path);
    Ok(())
}

pub(crate) fn session_id_for(issue_key: &str) -> Option<String> {
    let _guard = SESSIONS_FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    load_sessions().get(issue_key).cloned()
}

pub(crate) fn upsert_session_id(issue_key: &str, id: &str) -> Result<(), String> {
    let _guard = SESSIONS_FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = load_sessions();
    map.insert(issue_key.to_string(), id.to_string());
    save_sessions(&map)
}

/// Transfer a saved Claude conversation id to a new workspace key (used when
/// an exploratory session is linked to an issue — same conversation, new owner).
pub(crate) fn move_session_id(from: &str, to: &str) -> Result<(), String> {
    let _guard = SESSIONS_FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = load_sessions();
    if let Some(claude_id) = map.remove(from) {
        map.insert(to.to_string(), claude_id);
        save_sessions(&map)?;
    }
    Ok(())
}

pub(crate) fn forget_session_id(issue_key: &str) -> Result<(), String> {
    let _guard = SESSIONS_FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut map = load_sessions();
    if map.remove(issue_key).is_some() {
        save_sessions(&map)?;
    }
    Ok(())
}

/// Claude stores each conversation at `~/.claude/projects/<cwd-slug>/<id>.jsonl`,
/// where the slug is the cwd with every `/` and `.` replaced by `-`.
pub(crate) fn claude_conversation_exists(cwd: &str, session_id: &str) -> bool {
    let slug: String = cwd
        .chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect();
    dirs::home_dir()
        .map(|home| {
            home.join(".claude")
                .join("projects")
                .join(slug)
                .join(format!("{session_id}.jsonl"))
                .exists()
        })
        .unwrap_or(false)
}

/// Resolve the Claude `--resume`/`--session-id` args for a workspace: resume a
/// saved conversation, or pin (and persist) a fresh id. Codex manages its own
/// session state, so it gets neither. Shared by issue agents (`start_agent`) and
/// exploratory sessions (`start_session`).
///
/// A stored id is only resumed if its conversation actually exists on disk.
/// Claude writes the conversation file lazily (on the first message), so a
/// session opened and closed without interaction leaves a "poisoned" id —
/// persisted here but unknown to Claude, which would make `--resume` fail with
/// "No conversation found". We detect that and self-heal by pinning a fresh id.
pub(crate) fn claude_session_ids(
    workspace_id: &str,
    cli: &str,
    cwd: &str,
) -> (Option<String>, Option<String>) {
    if cli != "claude" {
        return (None, None);
    }
    if let Some(prev) = session_id_for(workspace_id) {
        if claude_conversation_exists(cwd, &prev) {
            return (Some(prev), None);
        }
        // Poisoned id — fall through and replace it with a fresh, usable one.
    }
    let fresh = new_id();
    let _ = upsert_session_id(workspace_id, &fresh);
    (None, Some(fresh))
}
