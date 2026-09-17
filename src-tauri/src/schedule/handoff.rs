//! Continuing a finished run as an exploratory session.
//!
//! A Claude conversation is keyed by its absolute cwd, so the session can't get a
//! worktree of its own — it *adopts* the prompt's (the same move linking a
//! session to an issue makes), and takes the run's conversation id, so starting
//! the session `--resume`s exactly where the run stopped. The two then share a
//! checkout; `worktrees::remove_for_workspace` leaves it in place until the last
//! of them is deleted.

use chrono::{Local, TimeZone};

use super::model::RunStatus;
use super::store;
use crate::commands::session::{create_session, ScratchSession};

pub fn continue_as_session(run_id: &str) -> Result<ScratchSession, String> {
    let run = store::runs()
        .into_iter()
        .find(|r| r.id == run_id)
        .ok_or("That run no longer exists.")?;
    if run.status == RunStatus::Running {
        return Err("Stop the run (or let it finish) before continuing it.".to_string());
    }
    let claude_id = run
        .claude_session_id
        .ok_or("This run never started a conversation, so there's nothing to continue.")?;
    let prompt = store::prompt(&run.prompt_id).ok_or("That scheduled prompt no longer exists.")?;
    let repo = prompt
        .repo
        .clone()
        .or_else(crate::commands::repos::default_repo)
        .ok_or("Add a repository in Settings first.")?;
    let dirname = crate::commands::repos::workspace_dirname(&prompt.id);
    if !std::path::Path::new(&format!("{repo}/.worktrees/{dirname}")).exists() {
        return Err(
            "The prompt's worktree is gone, so its conversation can't be resumed.".to_string(),
        );
    }

    let started = Local
        .timestamp_opt(run.started_at, 0)
        .single()
        .map(|t| t.format("%b %-d, %H:%M").to_string())
        .unwrap_or_default();
    let title = format!("{} · {started}", prompt.title);
    let session = create_session(
        title,
        "claude".to_string(),
        prompt.provider,
        Some(repo.clone()),
    )?;
    crate::commands::repos::adopt_workspace_dir(&session.id, &dirname, &repo)?;
    crate::claude::conversations::upsert_session_id(&session.id, &claude_id)?;
    Ok(session)
}
