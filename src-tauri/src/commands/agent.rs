//! Agent commands — start/stop interactive Claude sessions in per-issue
//! worktrees, and pipe keystrokes/resize to the PTY.

use std::collections::HashMap;

use tauri::{AppHandle, State};

use crate::claude::pty::spawn_claude_pty;
use crate::git;
use crate::helpers::{new_id, slugify};
use crate::state::AppState;

/// Point agents at a local git repository. Worktrees are created under it.
#[tauri::command]
pub fn set_repo_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if !git::is_git_repo(&trimmed) {
        return Err(format!("{trimmed} is not a git repository."));
    }
    *state.repo_path.write() = Some(trimmed);
    Ok(())
}

#[tauri::command]
pub fn get_repo_path(state: State<'_, AppState>) -> Option<String> {
    state.repo_path.read().clone()
}

#[tauri::command]
pub fn agent_running(state: State<'_, AppState>, issue_key: String) -> bool {
    state.pty_sessions.lock().contains_key(&issue_key)
}

/// Start an interactive Claude TUI for an issue, in its own git worktree.
/// Idempotent: if a session already exists for the issue, it's a no-op.
#[tauri::command]
pub fn start_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    issue_key: String,
    cols: u16,
    rows: u16,
    model: Option<String>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&issue_key) {
        return Ok(());
    }

    let repo = state
        .repo_path
        .read()
        .clone()
        .ok_or("Choose a repository folder in Settings before starting an agent.")?;

    let busy = git::git_busy_check(&repo);
    if busy.starts_with("busy") {
        return Err(format!("Repository is {busy} — finish that git operation first."));
    }

    let slug = slugify(&issue_key);
    let worktree = format!("{repo}/.worktrees/{slug}");
    let branch = format!("workspace/{slug}");
    let default_branch = git::get_default_branch(&repo);
    git::create_worktree(&repo, &worktree, &branch, &default_branch)?;

    let session_id = new_id();
    let (session, pid) = spawn_claude_pty(
        app,
        issue_key.clone(),
        worktree,
        None,
        Some(session_id),
        model,
        HashMap::new(),
        cols.max(20),
        rows.max(4),
    )?;

    state.pty_sessions.lock().insert(issue_key.clone(), session);
    if let Some(pid) = pid {
        state.child_pids.lock().insert(issue_key, pid);
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
    let sessions = state.pty_sessions.lock();
    match sessions.get(&issue_key) {
        Some(session) => session.resize(cols.max(20), rows.max(4)),
        None => Ok(()),
    }
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
