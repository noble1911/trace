//! Agent commands — start/stop interactive Claude sessions in per-issue
//! worktrees, and pipe keystrokes/resize to the PTY.

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::agent_session::runtime::{self, StartRequest};
use crate::agent_session::transport::{self, Transport};
use crate::claude::conversations::{claude_session_ids, forget_session_id};
use crate::claude::launch;
use crate::execution::SpawnSpec;
use crate::git;
use crate::helpers::slugify;
use crate::state::{AppState, StartGuard};

// ---- repo-path persistence ------------------------------------------------
// The repo path is non-secret app config. We store it next to the Jira session
// file in the user's config dir so the choice survives restarts (mirrors the
// pattern in `jira/auth.rs`). Path is re-validated lazily — start_agent will
// surface a clear error if the saved folder is no longer a git repo.

fn repo_path_file() -> PathBuf {
    crate::helpers::trace_dir().join("repo-path")
}

/// Load the legacy single-repo path, if any — read once to migrate into the
/// multi-repo `repos.json` (see `commands::repos`).
pub fn load_repo_path() -> Option<String> {
    std::fs::read_to_string(repo_path_file())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Start `workspace_id`'s agent in `cwd`, on the transport `transport::resolve`
/// picks: a chat agent (`agent_session::runtime`), or an interactive PTY
/// registered in state with its Claude session-id persistence wired. Every
/// start path comes through here, so each honours the workspace's transport.
/// Identifier-agnostic — `workspace_id` is a Jira key for board agents or a
/// session id for exploratory ones. Idempotent: a no-op if its agent is live.
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
    // Sent instead of `initial_prompt` when a saved Claude conversation is
    // resumed: re-greeting it with the kickoff brief would be noise, but one
    // cut off mid-task needs telling to carry on (`interrupted`).
    resume_prompt: Option<String>,
    // Model provider for the Claude harness: a registered Anthropic-compatible
    // endpoint (commands::providers::spec — "moonshot", "wafer" / "wafer-fast",
    // "deepseek" / "deepseek-pro"). Only meaningful with cli == "claude";
    // ignored otherwise.
    provider: Option<String>,
    // Chat or terminal, as the caller chose; `None` keeps what the workspace
    // ran on last (the terminal if it never ran).
    transport: Option<Transport>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // This machine, or a sandbox (`session_host`). A remote agent is always a
    // terminal, and nothing below that reads this disk applies to it.
    let host = crate::commands::session_host::host_for(&workspace_id)?;
    let local = host.is_local();
    let transport = match local || host.port().capabilities().chat {
        true => transport::resolve(transport, transport::stored(&workspace_id), &cli),
        false => Transport::Terminal,
    };
    // A worktree of a repo the user added needs no "trust this folder?" stop, in
    // either transport (a chat agent can later open in the terminal).
    if cli == "claude" && local {
        crate::claude::folder_trust::trust_worktree(&cwd);
    }
    // A scheduled run keeps its transport on the run record (one id per run).
    let remembered = !workspace_id.starts_with(crate::schedule::RUN_PREFIX);
    if transport == Transport::Chat {
        if state.pty_sessions.lock().contains_key(&workspace_id) {
            return Err("This agent is running in a terminal. Stop it first.".to_string());
        }
        if remembered {
            transport::remember(&workspace_id, transport);
        }
        let req = StartRequest {
            workspace_id,
            cli,
            cwd,
            model,
            provider,
            extra_args,
            initial_prompt,
            resume_prompt,
            remote: host.port().chat_opener(),
        };
        return runtime::start(&app, state, req);
    }
    if state.pty_sessions.lock().contains_key(&workspace_id) {
        return Ok(());
    }
    // One process per conversation: a chat agent on it would collide on its id.
    if state.chat_agents.is_running(&workspace_id) {
        return Err("This agent is running as a chat. Stop it first.".to_string());
    }
    if remembered {
        transport::remember(&workspace_id, transport);
    }
    let (resume_id, new_id_arg) = match local {
        true => claude_session_ids(&workspace_id, &cli, &cwd),
        false => (None, None),
    };
    // Until this spawn's hooks report, its conversation is the one just resolved.
    crate::claude::transcript::live::forget(state, &workspace_id);
    let resuming = cli == "claude" && resume_id.is_some();
    // Another host decides for itself whether it continues a conversation.
    let remote_resume_prompt = if local { None } else { resume_prompt.clone() };
    let prompt = if resuming {
        resume_prompt
    } else {
        initial_prompt
    }
    .filter(|p| !p.trim().is_empty());
    // What the caller asked for, before trace adds its own flags below — enough
    // to start it again after an interrupted quit (`interrupted`).
    let launch = crate::interrupted::AgentLaunch {
        workspace_id: workspace_id.clone(),
        cwd: cwd.clone(),
        cli: cli.clone(),
        model: model.clone(),
        provider: provider.clone(),
        extra_args: extra_args.clone(),
        started_at: 0,
        pid: None,
        // A prompt starts a turn; the hooks keep this current from here on.
        busy: prompt.is_some(),
        transport: Transport::Terminal,
    };
    // trace's wiring (`claude::launch`): the render bridge for every CLI, and for
    // Claude its tools, turn hooks and the provider's endpoint + model.
    // A remote agent gets only the provider's part: the loopback can't reach it.
    let (model, extra_args, env_overrides) = if !local {
        let wiring =
            launch::provider_wiring(&workspace_id, model, provider.as_deref(), extra_args)?;
        (wiring.model, wiring.extra_args, wiring.env)
    } else if cli == "claude" {
        let wiring = launch::claude_wiring(
            &app,
            state,
            &workspace_id,
            model,
            provider.as_deref(),
            extra_args,
            false,
        )?;
        (wiring.model, wiring.extra_args, wiring.env)
    } else if cli == "codex" {
        let wiring = launch::codex_wiring(&app, state, &workspace_id, model, extra_args);
        (wiring.model, wiring.extra_args, wiring.env)
    } else {
        let env = launch::bridge_env(&app, state, &workspace_id);
        (model, extra_args, env)
    };
    let spec = SpawnSpec {
        workspace_id: workspace_id.clone(),
        cwd,
        cli,
        resume_id,
        new_session_id: new_id_arg,
        model,
        extra_args,
        prompt,
        resume_prompt: remote_resume_prompt,
        env: env_overrides,
        cols: cols.max(20),
        rows: rows.max(4),
    };
    let session = host.port().spawn(&app, spec).map_err(|e| e.to_string())?;
    let pid = session.pid();
    state
        .pty_sessions
        .lock()
        .insert(workspace_id.clone(), session);
    // A remote agent outlives trace by itself, so it isn't "interrupted" by a quit.
    if local {
        crate::interrupted::record_start(launch, pid);
    }
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

/// Whether the workspace's agent is live, on either transport.
#[tauri::command]
pub fn agent_running(state: State<'_, AppState>, issue_key: String) -> bool {
    state.pty_sessions.lock().contains_key(&issue_key) || state.chat_agents.is_running(&issue_key)
}

/// Every live PTY's workspace id, shells and scheduled runs included. A renderer
/// reload forgets what's running while the PTYs survive it, so the renderer adopts
/// this list at startup rather than waiting for each agent to be opened.
#[tauri::command]
pub fn live_workspaces(state: State<'_, AppState>) -> Vec<String> {
    let mut ids: Vec<String> = state.pty_sessions.lock().keys().cloned().collect();
    ids.extend(state.chat_agents.workspaces());
    ids
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
    // "chat" | "terminal"; unset keeps what the ticket ran on last.
    transport: Option<String>,
    // "local" | "vercel": where it runs; unset keeps what the ticket ran on last.
    host: Option<String>,
    // The ticket's board (`provider:boardId`), whose settings can pick its repo.
    board_key: Option<String>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&issue_key) {
        return Ok(());
    }
    // Reserve the id for the whole start so a racing second request can't spawn a
    // duplicate agent during the slow worktree step. Released when `_guard` drops.
    let Some(_guard) = StartGuard::acquire(&state, &issue_key) else {
        return Ok(());
    };

    let match_text = match_text.unwrap_or_default();
    let cli = cli.unwrap_or_else(|| "claude".to_string());
    // Before anything resolves the repo: the board's settings may pin it.
    crate::commands::board_settings::pin_board_repo(&issue_key, board_key.as_deref())?;
    // A sandbox clones the repo itself: no local worktree, and only Claude runs there.
    let sandbox = crate::commands::issue_host::settle(&issue_key, &match_text, host.as_deref())?;
    let worktree = match sandbox {
        Some(_) if cli != "claude" => {
            return Err("Only Claude runs in a cloud sandbox.".to_string());
        }
        Some(sandbox) => crate::commands::session_host::sandbox_cwd(&sandbox),
        None => issue_worktree(&issue_key, &match_text)?,
    };
    spawn_in(
        app,
        &state,
        issue_key,
        worktree,
        cli,
        model,
        extra_args.unwrap_or_default(),
        initial_prompt,
        None,
        provider,
        transport.as_deref().and_then(Transport::parse),
        cols,
        rows,
    )
}

/// The worktree an issue's agent runs in, created if needed: the repo its
/// mappings pick (pinned, so diff/PR/tests resolve the same one), on branch
/// `workspace/<slug>`. Shared by terminal and chat agents.
pub(crate) fn issue_worktree(issue_key: &str, match_text: &str) -> Result<String, String> {
    let repo = crate::commands::repos::repo_for_matching(issue_key, match_text)?;
    // Pin it so diff/PR/tests (which only know the key) resolve the same repo.
    crate::commands::repos::assign_repo(issue_key, &repo)?;

    let busy = git::git_busy_check(&repo);
    if busy.starts_with("busy") {
        return Err(format!(
            "Repository is {busy} — finish that git operation first."
        ));
    }

    // Path through the dirname helper: a linked issue adopted its session's
    // worktree, in which case it already exists and create_worktree no-ops.
    let worktree = crate::commands::repos::workspace_dir(&repo, issue_key);
    let branch = format!("workspace/{}", slugify(issue_key));
    let default_branch = git::get_default_branch(&repo);
    git::create_worktree(&repo, &worktree, &branch, &default_branch)?;
    Ok(worktree)
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

/// Resize a workspace's PTY. Returns whether a PTY was there to take it: an
/// agent that's still starting (worktree creation takes seconds) has none yet,
/// and the renderer must not count that size as delivered, or the PTY spawns at
/// the old size and the TUI stays a column wider than the grid for good.
#[tauri::command]
pub fn resize_agent(
    state: State<'_, AppState>,
    issue_key: String,
    cols: u16,
    rows: u16,
) -> Result<bool, String> {
    let (cols, rows) = (cols.max(20), rows.max(4));
    // Track the new dimensions on the output history — a snapshot replay must
    // happen at the size the bytes were painted for.
    if let Some(h) = state.output_history.lock().get_mut(&issue_key) {
        h.cols = cols;
        h.rows = rows;
    }
    let sessions = state.pty_sessions.lock();
    match sessions.get(&issue_key) {
        Some(session) => session.resize(cols, rows).map(|()| true),
        None => Ok(false),
    }
}

/// Disconnect from an agent on another host and leave it running there. Its
/// session ends here like a stop, and starting it again joins it. A local agent
/// can't be left running without trace, so it's refused rather than stopped.
#[tauri::command]
pub fn detach_agent(state: State<'_, AppState>, issue_key: String) -> Result<(), String> {
    let mut sessions = state.pty_sessions.lock();
    match sessions.get(&issue_key) {
        Some(s) if s.can_detach() => {}
        Some(_) => return Err("Only an agent running on another host can be left running.".into()),
        None => {
            drop(sessions);
            // A chat agent: only a remote one can be left running.
            return match runtime::detach(&state, &issue_key)
                || !state.chat_agents.is_running(&issue_key)
            {
                true => Ok(()),
                false => Err("Only an agent running on another host can be left running.".into()),
            };
        }
    }
    let session = sessions.remove(&issue_key);
    drop(sessions);
    // Dropping a remote session is what detaches it.
    drop(session);
    Ok(())
}

/// Stop an agent: take it out of state and kill the child (its EOF triggers the
/// pump thread's run-state cleanup). A chat agent is asked to end; it reports
/// its exit the same way once its process is gone.
#[tauri::command]
pub fn stop_agent(state: State<'_, AppState>, issue_key: String) -> Result<(), String> {
    runtime::stop(&state, &issue_key);
    let session = state.pty_sessions.lock().remove(&issue_key);
    state.child_pids.lock().remove(&issue_key);
    if let Some(mut session) = session {
        session.stop();
    }
    Ok(())
}
