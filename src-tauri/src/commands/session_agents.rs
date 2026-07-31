//! Companion agents on an exploratory session.
//!
//! A session owns one worktree. Sometimes the work started there should be picked
//! up by a *different* CLI — code written with claude, then continued or reviewed
//! with codex — or by a second instance of the same one. A companion agent is
//! exactly that: its own PTY and its own conversation, rooted in the *same*
//! worktree as the session hosting it.
//!
//! A companion is addressed by its own opaque id, which is a workspace id like
//! any other — so input/resize/stop/snapshot/editor all work on it with no
//! special cases, because `session::owning_session` maps the id back to the
//! session that owns the worktree.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::agent::{forget_session_id, spawn_in};
use crate::commands::session::{load, save, session_cwd, ScratchSession};
use crate::helpers::new_id;
use crate::state::{AppState, StartGuard};

/// How many companions one session may host. A cap keeps the detail tab bar
/// readable — and N agents editing one worktree stops being useful long before.
const MAX_AGENTS: usize = 4;

/// A second CLI sharing a session's worktree.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionAgent {
    /// Opaque id, and also this agent's workspace id (PTY key, conversation key).
    pub id: String,
    /// "claude" | "codex".
    pub cli: String,
    /// Model provider for the Claude harness (see commands::providers::spec).
    #[serde(default)]
    pub provider: Option<String>,
}

/// Add a companion agent to a session. Persists it but does not start it — the
/// detail view starts it at the terminal's measured size, like every other agent.
#[tauri::command]
pub fn add_session_agent(
    id: String,
    cli: String,
    provider: Option<String>,
) -> Result<ScratchSession, String> {
    let cli = if cli == "codex" { "codex" } else { "claude" }.to_string();
    // Only Claude takes a model provider, and only known ones (spec() = the
    // registry of Anthropic-compatible endpoints in commands::providers).
    let provider = if cli == "claude" {
        provider.filter(|p| crate::commands::providers::spec(p).is_some())
    } else {
        None
    };
    let mut list = load();
    let Some(session) = list.iter_mut().find(|s| s.id == id) else {
        return Err("That session no longer exists.".to_string());
    };
    if session.agents.len() >= MAX_AGENTS {
        return Err(format!("A session can host at most {MAX_AGENTS} extra agents."));
    }
    session.agents.push(SessionAgent { id: new_id(), cli, provider });
    let updated = session.clone();
    save(&list)?;
    Ok(updated)
}

/// Remove a companion: kill its PTY, forget its conversation, drop the record.
/// The worktree is untouched — it belongs to the session, not to this agent.
#[tauri::command]
pub fn remove_session_agent(
    state: State<'_, AppState>,
    id: String,
    agent_id: String,
) -> Result<ScratchSession, String> {
    discard_agents(&state, std::slice::from_ref(&agent_id));
    let _ = forget_session_id(&agent_id);
    let mut list = load();
    let Some(session) = list.iter_mut().find(|s| s.id == id) else {
        return Err("That session no longer exists.".to_string());
    };
    session.agents.retain(|a| a.id != agent_id);
    let updated = session.clone();
    save(&list)?;
    Ok(updated)
}

/// Start (or resume) a companion in its session's worktree — created on demand,
/// exactly like `start_session`, so a companion can be the first thing you run in
/// a session. Idempotent: a no-op if its PTY is already live.
#[tauri::command]
pub fn start_session_agent(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    agent_id: String,
    cols: u16,
    rows: u16,
    extra_args: Option<Vec<String>>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&agent_id) {
        return Ok(());
    }
    let Some(_guard) = StartGuard::acquire(&state, &agent_id) else {
        return Ok(());
    };

    let session =
        load().into_iter().find(|s| s.id == id).ok_or("That session no longer exists.")?;
    let agent = session
        .agents
        .iter()
        .find(|a| a.id == agent_id)
        .ok_or("That agent is no longer part of this session.")?;
    let cli = agent.cli.clone();
    let provider = agent.provider.clone();
    let cwd = session_cwd(&id, true)?;

    spawn_in(
        app,
        &state,
        agent_id,
        cwd,
        cli,
        None,
        extra_args.unwrap_or_default(),
        None,
        provider,
        cols,
        rows,
    )
}

/// Kill the PTYs for a set of workspace ids, keeping their output history so a
/// re-opened workspace comes back with its screen. Used when a host session is
/// archived — its companions go down with it, but nothing is discarded.
pub(crate) fn stop_agents(state: &AppState, ids: &[String]) {
    for id in ids {
        // Take the session out of the map (dropping the guard) before killing it,
        // so we never hold a lock across the wait.
        let live = state.pty_sessions.lock().remove(id);
        if let Some(mut session) = live {
            session.kill();
        }
        state.child_pids.lock().remove(id);
    }
}

/// Stop *and* forget: for workspaces that are going away for good (a deleted
/// session, one linked to an issue, a removed companion), so no stale history is
/// replayed into a terminal that gets the id next.
pub(crate) fn discard_agents(state: &AppState, ids: &[String]) {
    stop_agents(state, ids);
    let mut histories = state.output_history.lock();
    for id in ids {
        histories.remove(id);
    }
}
