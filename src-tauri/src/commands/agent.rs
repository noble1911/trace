//! Agent commands — start/stop interactive Claude sessions in per-issue
//! worktrees, and pipe keystrokes/resize to the PTY.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, State};

use crate::claude::pty::{spawn_agent_pty, spawn_shell_pty};
use crate::git;
use crate::helpers::{new_id, restrict_perms, slugify};
use crate::state::{AppState, StartGuard};

// ---- repo-path persistence ------------------------------------------------
// The repo path is non-secret app config. We store it next to the Jira session
// file in the user's config dir so the choice survives restarts (mirrors the
// pattern in `jira/auth.rs`). Path is re-validated lazily — start_agent will
// surface a clear error if the saved folder is no longer a git repo.

fn repo_path_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("repo-path")
}

/// Load the legacy single-repo path, if any — read once to migrate into the
/// multi-repo `repos.json` (see `commands::repos`).
pub fn load_repo_path() -> Option<String> {
    std::fs::read_to_string(repo_path_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ---- Claude session-id persistence ----------------------------------------
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

fn session_id_for(issue_key: &str) -> Option<String> {
    let _guard = SESSIONS_FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    load_sessions().get(issue_key).cloned()
}

fn upsert_session_id(issue_key: &str, id: &str) -> Result<(), String> {
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
fn claude_conversation_exists(cwd: &str, session_id: &str) -> bool {
    let slug: String = cwd.chars().map(|c| if c == '/' || c == '.' { '-' } else { c }).collect();
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

/// Spawn an interactive agent PTY for `workspace_id` rooted at `cwd`, register it
/// in state, and wire its Claude session-id persistence. Identifier-agnostic —
/// `workspace_id` is a Jira key for board agents or a session id for exploratory
/// ones. Idempotent: a no-op if a session is already live for the id.
#[allow(clippy::too_many_arguments)]
pub(crate) fn spawn_in(
    app: AppHandle,
    state: &AppState,
    workspace_id: String,
    cwd: String,
    cli: String,
    model: Option<String>,
    extra_args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&workspace_id) {
        return Ok(());
    }
    let (resume_id, new_id_arg) = claude_session_ids(&workspace_id, &cli, &cwd);
    let (session, pid) = spawn_agent_pty(
        app,
        workspace_id.clone(),
        cwd,
        cli,
        resume_id,
        new_id_arg,
        model,
        extra_args,
        HashMap::new(),
        cols.max(20),
        rows.max(4),
    )?;
    state.pty_sessions.lock().insert(workspace_id.clone(), session);
    if let Some(pid) = pid {
        state.child_pids.lock().insert(workspace_id, pid);
    }
    Ok(())
}

/// Forget the saved Claude session id for an issue so the next start begins a
/// fresh conversation. No-op if no session was recorded.
#[tauri::command]
pub fn reset_agent_session(issue_key: String) -> Result<(), String> {
    forget_session_id(&issue_key)
}

#[tauri::command]
pub fn agent_running(state: State<'_, AppState>, issue_key: String) -> bool {
    state.pty_sessions.lock().contains_key(&issue_key)
}

/// Start an interactive Claude TUI for an issue, in its own git worktree.
/// Idempotent: if a session already exists for the issue, it's a no-op.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn start_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_key: String,
    cols: u16,
    rows: u16,
    model: Option<String>,
    cli: Option<String>,
    extra_args: Option<Vec<String>>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&issue_key) {
        return Ok(());
    }
    // Reserve the id for the whole start so a racing second request can't spawn a
    // duplicate agent during the slow worktree step. Released when `_guard` drops.
    let Some(_guard) = StartGuard::acquire(&state, &issue_key) else {
        return Ok(());
    };

    let repo = crate::commands::repos::repo_for(&issue_key)?;

    let busy = git::git_busy_check(&repo);
    if busy.starts_with("busy") {
        return Err(format!("Repository is {busy} — finish that git operation first."));
    }

    // Path through the dirname helper: a linked issue adopted its session's
    // worktree, in which case it already exists and create_worktree no-ops.
    let worktree = crate::commands::repos::workspace_dir(&repo, &issue_key);
    let branch = format!("workspace/{}", slugify(&issue_key));
    let default_branch = git::get_default_branch(&repo);
    git::create_worktree(&repo, &worktree, &branch, &default_branch)?;

    let cli = cli.unwrap_or_else(|| "claude".to_string());
    spawn_in(app, &state, issue_key, worktree, cli, model, extra_args.unwrap_or_default(), cols, rows)
}

/// Start a plain shell in the issue's worktree — the "Terminal" tab, separate
/// from the Claude agent in Chat. Keyed by `term:<issue>` so it coexists with the
/// agent session. Ensures the worktree exists first. Idempotent.
#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_key: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let term_id = format!("term:{issue_key}");
    if state.pty_sessions.lock().contains_key(&term_id) {
        return Ok(());
    }
    let Some(_guard) = StartGuard::acquire(&state, &term_id) else {
        return Ok(());
    };

    // The shell opens wherever the workspace's agent runs: a session's
    // worktree when it has one, the repo root for legacy root sessions, or
    // the issue's worktree (created on demand).
    let cwd = if crate::commands::session::is_session(&issue_key) {
        let repo = crate::commands::repos::default_repo()
            .ok_or("Add a repository in Settings before opening a terminal.")?;
        let worktree = crate::commands::repos::workspace_dir(&repo, &issue_key);
        if std::path::Path::new(&worktree).exists() {
            worktree
        } else {
            repo
        }
    } else {
        let repo = crate::commands::repos::repo_for(&issue_key)?;
        let worktree = crate::commands::repos::workspace_dir(&repo, &issue_key);
        if !std::path::Path::new(&worktree).exists() {
            let busy = git::git_busy_check(&repo);
            if busy.starts_with("busy") {
                return Err(format!("Repository is {busy} — finish that git operation first."));
            }
            let branch = format!("workspace/{}", slugify(&issue_key));
            let default_branch = git::get_default_branch(&repo);
            git::create_worktree(&repo, &worktree, &branch, &default_branch)?;
        }
        worktree
    };

    let (session, pid) = spawn_shell_pty(app, term_id.clone(), cwd, cols.max(20), rows.max(4))?;
    state.pty_sessions.lock().insert(term_id.clone(), session);
    if let Some(pid) = pid {
        state.child_pids.lock().insert(term_id, pid);
    }
    Ok(())
}

/// Forward keystrokes / pasted text from the xterm pane to the TUI.
#[tauri::command]
pub fn send_agent_input(
    state: State<'_, AppState>,
    issue_key: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock();
    let session = sessions
        .get_mut(&issue_key)
        .ok_or("No running agent for this issue.")?;
    session
        .write_input(data.as_bytes())
        .map_err(|e| format!("Failed to write to agent: {e}"))
}

#[tauri::command]
pub fn resize_agent(
    state: State<'_, AppState>,
    issue_key: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let (cols, rows) = (cols.max(20), rows.max(4));
    // Track the new dimensions on the output history — a snapshot replay must
    // happen at the size the bytes were painted for.
    if let Some(h) = state.output_history.lock().get_mut(&issue_key) {
        h.cols = cols;
        h.rows = rows;
    }
    let sessions = state.pty_sessions.lock();
    match sessions.get(&issue_key) {
        Some(session) => session.resize(cols, rows),
        None => Ok(()),
    }
}

/// Everything needed to rebuild a terminal after a renderer reload: the
/// rolling output history plus the PTY size it was painted at. `None` when
/// the workspace never produced output (or its history was torn down).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySnapshot {
    pub chunks: Vec<String>,
    /// Highest seq included — live chunks at or below this are already here.
    pub seq: u64,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn pty_snapshot(state: State<'_, AppState>, workspace_id: String) -> Option<PtySnapshot> {
    let histories = state.output_history.lock();
    let h = histories.get(&workspace_id)?;
    if h.chunks.is_empty() {
        return None;
    }
    Some(PtySnapshot {
        chunks: h.chunks.iter().map(|(_, c)| c.clone()).collect(),
        seq: h.seq,
        cols: h.cols,
        rows: h.rows,
    })
}

/// Stop an agent: take it out of state and kill the child (its EOF triggers the
/// pump thread's run-state cleanup).
#[tauri::command]
pub fn stop_agent(state: State<'_, AppState>, issue_key: String) -> Result<(), String> {
    let session = state.pty_sessions.lock().remove(&issue_key);
    state.child_pids.lock().remove(&issue_key);
    if let Some(mut session) = session {
        session.kill();
    }
    Ok(())
}
