//! Agent commands — start/stop interactive Claude sessions in per-issue
//! worktrees, and pipe keystrokes/resize to the PTY.

use std::collections::HashMap;
use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::claude::conversations::{claude_session_ids, forget_session_id};
use crate::claude::pty::{spawn_agent_pty, spawn_shell_pty};
use crate::claude::{hooks, render_bridge};
use crate::git;
use crate::helpers::slugify;
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
    initial_prompt: Option<String>,
    // Model provider for the Claude harness: a registered Anthropic-compatible
    // endpoint (commands::providers::spec — "moonshot", "wafer" / "wafer-fast",
    // "deepseek" / "deepseek-pro"). Only meaningful with cli == "claude";
    // ignored otherwise.
    provider: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&workspace_id) {
        return Ok(());
    }
    let (resume_id, new_id_arg) = claude_session_ids(&workspace_id, &cli, &cwd);
    // Start the loopback HTML bridge once (lazily) and hand this agent the
    // coordinates so its `trace-render` can post cards to the panel. Bind failure
    // yields a disabled bridge (port 0) and we simply skip the injection.
    let bridge = state
        .render_bridge
        .get_or_init(|| render_bridge::start(app.clone()).unwrap_or_default());
    let mut env_overrides = HashMap::new();
    if bridge.port != 0 {
        env_overrides.insert("TRACE_ISSUE_KEY".to_string(), workspace_id.clone());
        env_overrides.insert("TRACE_RENDER_PORT".to_string(), bridge.port.to_string());
        env_overrides.insert("TRACE_RENDER_TOKEN".to_string(), bridge.token.clone());
    }
    let mut model = model;
    let mut extra_args = extra_args;
    if cli == "claude" {
        // Turn hooks (`claude::hooks`) report through the bridge, so they need it.
        // Appended last: `--settings <json>` also ends any variadic user flag
        // (e.g. `--allowedTools Bash Edit`) that would otherwise swallow a prompt.
        // Best-effort — without them the renderer falls back to its quiet timer.
        if bridge.port != 0 {
            if let Ok(settings) = hooks::settings_arg() {
                extra_args.push("--settings".to_string());
                extra_args.push(settings);
            }
        }
        if let Some(spec) = provider.as_deref().and_then(crate::commands::providers::spec) {
            // The Settings default model targets Anthropic (e.g. "fable") and
            // doesn't resolve on a third-party endpoint — keep only models that
            // clearly belong to this provider, else use its default. Resolved
            // before env injection so the DEFAULT_*/SUBAGENT aliases pin to the
            // same id that `--model` receives.
            match model.as_deref() {
                // Prefix match is case-insensitive so Wafer's `Kimi-K3` and a
                // typed `kimi-k3-fast` both count as belonging to the provider.
                Some(m)
                    if m.to_ascii_lowercase()
                        .starts_with(&spec.model_prefix.to_ascii_lowercase()) => {}
                _ => model = Some(spec.default_model.to_string()),
            }
            let provider_model = model.as_deref().unwrap_or(spec.default_model);
            env_overrides.extend(crate::commands::providers::env(spec, provider_model)?);
        }
    }
    let (session, pid) = spawn_agent_pty(
        app,
        workspace_id.clone(),
        cwd,
        cli,
        resume_id,
        new_id_arg,
        model,
        extra_args,
        initial_prompt,
        env_overrides,
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
    provider: Option<String>,
    extra_args: Option<Vec<String>>,
    initial_prompt: Option<String>,
    // The ticket's summary + labels, so repo mappings can match a tag like "[BE]"
    // that lives in the title rather than the key.
    match_text: Option<String>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&issue_key) {
        return Ok(());
    }
    // Reserve the id for the whole start so a racing second request can't spawn a
    // duplicate agent during the slow worktree step. Released when `_guard` drops.
    let Some(_guard) = StartGuard::acquire(&state, &issue_key) else {
        return Ok(());
    };

    let repo =
        crate::commands::repos::repo_for_matching(&issue_key, match_text.as_deref().unwrap_or(""))?;
    // Pin it so diff/PR/tests (which only know the key) resolve the same repo.
    crate::commands::repos::assign_repo(&issue_key, &repo)?;

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
    spawn_in(
        app,
        &state,
        issue_key,
        worktree,
        cli,
        model,
        extra_args.unwrap_or_default(),
        initial_prompt,
        provider,
        cols,
        rows,
    )
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

    // The shell opens wherever the workspace's agent runs: a session's worktree
    // (created on demand, using the session's own repo — not the global default),
    // the repo root for legacy root sessions, or the issue's worktree.
    let cwd = if crate::commands::session::is_session(&issue_key) {
        crate::commands::session::session_cwd(&issue_key, true)?
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
