//! Exploratory ("scratch") sessions — interactive agents not tied to a Jira
//! issue. They run in the configured repo root (no worktree) and persist their
//! metadata locally so they survive restarts. The PTY transport, the stop/input/
//! resize commands, and Claude session-id resume are all shared with board
//! agents (`commands::agent`), keyed by the session id.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::agent::{forget_session_id, spawn_in};
use crate::git;
use crate::helpers::new_id;
use crate::state::{AppState, StartGuard};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScratchSession {
    pub id: String,
    pub title: String,
    /// "claude" | "codex".
    pub cli: String,
    /// Unix epoch seconds at creation (display ordering on the frontend).
    pub created_at: u64,
    /// Epoch seconds when archived (in the recycle bin); `None` = active. Purged
    /// automatically after the retention window.
    #[serde(default)]
    pub archived_at: Option<u64>,
}

/// How long an archived session lingers before it's auto-purged (14 days).
const ARCHIVE_RETENTION_SECS: u64 = 14 * 24 * 60 * 60;

fn sessions_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("scratch.json")
}

fn load() -> Vec<ScratchSession> {
    std::fs::read_to_string(sessions_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(list: &[ScratchSession]) -> Result<(), String> {
    let path = sessions_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(list).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// All saved sessions (active + archived), newest first. Archived sessions past
/// the retention window are purged here (and their Claude ids forgotten).
#[tauri::command]
pub fn list_sessions() -> Vec<ScratchSession> {
    let now = now_secs();
    let mut list = load();
    let before = list.len();
    list.retain(|s| match s.archived_at {
        Some(at) => {
            let keep = now.saturating_sub(at) < ARCHIVE_RETENTION_SECS;
            if !keep {
                let _ = forget_session_id(&s.id);
            }
            keep
        }
        None => true,
    });
    if list.len() != before {
        let _ = save(&list);
    }
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

/// Create (persist) a new exploratory session. Does not start its agent.
#[tauri::command]
pub fn create_session(title: String, cli: String) -> Result<ScratchSession, String> {
    let title = title.trim();
    let title = if title.is_empty() { "Exploration".to_string() } else { title.to_string() };
    let cli = if cli == "codex" { "codex" } else { "claude" }.to_string();
    let session =
        ScratchSession { id: new_id(), title, cli, created_at: now_secs(), archived_at: None };
    let mut list = load();
    list.push(session.clone());
    save(&list)?;
    Ok(session)
}

/// Move a session to the recycle bin: stop its PTY but keep its metadata and
/// Claude id so it can be restored and resumed.
#[tauri::command]
pub fn archive_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let live = state.pty_sessions.lock().remove(&id);
    if let Some(mut session) = live {
        session.kill();
    }
    state.child_pids.lock().remove(&id);
    let mut list = load();
    let now = now_secs();
    for s in &mut list {
        if s.id == id {
            s.archived_at = Some(now);
        }
    }
    save(&list)
}

/// Restore a session from the recycle bin.
#[tauri::command]
pub fn unarchive_session(id: String) -> Result<(), String> {
    let mut list = load();
    for s in &mut list {
        if s.id == id {
            s.archived_at = None;
        }
    }
    save(&list)
}

/// Delete a session: stop its PTY if live, drop its saved Claude id, remove it.
#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Take the session out of the map (dropping the guard) before killing it, so
    // we never hold the lock across the wait.
    let live = state.pty_sessions.lock().remove(&id);
    if let Some(mut session) = live {
        session.kill();
    }
    state.child_pids.lock().remove(&id);
    let _ = forget_session_id(&id);
    let mut list = load();
    list.retain(|s| s.id != id);
    save(&list)
}

/// Start an exploratory session's agent in the configured repo root (no worktree).
#[tauri::command]
pub fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    extra_args: Option<Vec<String>>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&id) {
        return Ok(());
    }
    let Some(_guard) = StartGuard::acquire(&state, &id) else {
        return Ok(());
    };

    let session =
        load().into_iter().find(|s| s.id == id).ok_or("That session no longer exists.")?;

    let repo = crate::commands::repos::default_repo()
        .ok_or("Add a repository in Settings before starting a session.")?;

    let busy = git::git_busy_check(&repo);
    if busy.starts_with("busy") {
        return Err(format!("Repository is {busy} — finish that git operation first."));
    }

    spawn_in(app, &state, id, repo, session.cli, None, extra_args.unwrap_or_default(), cols, rows)
}
