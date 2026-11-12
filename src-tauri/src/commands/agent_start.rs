//! Starting a ticket's agent: its repo (the board's, when its settings pick
//! one), its host, its worktree, then the shared start path
//! (`agent::spawn_in`).

use tauri::{AppHandle, State};

use super::agent::spawn_in;
use crate::agent_session::transport::Transport;
use crate::board_settings::pin;
use crate::git;
use crate::helpers::slugify;
use crate::state::{AppState, StartGuard};

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
    // Before anything resolves the repo: the board's settings may pin it. Taken
    // back if the start fails before its worktree exists.
    let pinned = pin::pin(&issue_key, board_key.as_deref())?;
    let worktree = match workspace(&issue_key, &match_text, host.as_deref(), &cli) {
        Ok(worktree) => worktree,
        Err(e) => {
            pin::unpin(&issue_key, pinned.as_deref());
            return Err(e);
        }
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

/// Where the agent runs: a cloud sandbox's checkout (the sandbox clones the
/// repo itself, and only Claude runs there), else the ticket's local worktree.
fn workspace(
    issue_key: &str,
    match_text: &str,
    host: Option<&str>,
    cli: &str,
) -> Result<String, String> {
    match crate::commands::issue_host::settle(issue_key, match_text, host)? {
        Some(_) if cli != "claude" => Err("Only Claude runs in a cloud sandbox.".to_string()),
        Some(sandbox) => Ok(crate::commands::session_host::sandbox_cwd(&sandbox)),
        None => issue_worktree(issue_key, match_text),
    }
}

/// The worktree an issue's agent runs in, created if needed: the repo its
/// mappings pick (pinned, so diff/PR/tests resolve the same one), on branch
/// `workspace/<slug>`. Shared by terminal and chat agents.
fn issue_worktree(issue_key: &str, match_text: &str) -> Result<String, String> {
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
