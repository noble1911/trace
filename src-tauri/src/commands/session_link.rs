//! Binding an exploratory session to a Jira issue.
//!
//! The interesting constraint: a Claude conversation is keyed by its absolute
//! cwd, so the worktree can't be moved — the *issue* has to adopt it where it
//! already sits. That makes linking a four-part handover (PTYs down, branch
//! renamed to the issue convention so PRs work, worktree re-registered under the
//! issue key, conversation id transferred) rather than a metadata edit, which is
//! why it lives in its own module.

use tauri::State;

use crate::commands::agent::forget_session_id;
use crate::commands::session::{load, save};
use crate::commands::session_agents::discard_agents;
use crate::state::AppState;

/// Bind an exploratory session's workspace to a Jira issue. Nothing moves on
/// disk — the issue *adopts* the session's worktree (a Claude conversation is
/// keyed by its absolute cwd, so relocating it would orphan the history), the
/// conversation id transfers to the issue key, the branch is renamed to the
/// issue convention so PRs work, and the session is consumed.
#[tauri::command]
pub fn link_session_to_issue(
    state: State<'_, AppState>,
    id: String,
    issue_key: String,
) -> Result<(), String> {
    let mut list = load();
    let Some(pos) = list.iter().position(|s| s.id == id) else {
        return Err("That session no longer exists.".to_string());
    };
    if !list[pos].worktree {
        return Err(
            "This session predates worktree sessions and shares the repo root — it can't be \
             bound to a ticket."
                .to_string(),
        );
    }
    let repo = list[pos]
        .repo
        .clone()
        .or_else(crate::commands::repos::default_repo)
        .ok_or("Add a repository in Settings first.")?;
    let dirname = crate::commands::repos::workspace_dirname(&id);
    let dir = format!("{repo}/.worktrees/{dirname}");
    if !std::path::Path::new(&dir).exists() {
        return Err("Start this session once before linking — it has no worktree yet.".to_string());
    }
    // Refuse if the issue already has its own checkout — merging two working
    // trees isn't something we can do safely.
    let issue_dir = crate::commands::repos::workspace_dir(&repo, &issue_key);
    if issue_dir != dir && std::path::Path::new(&issue_dir).exists() {
        return Err(format!(
            "{issue_key} already has a worktree — remove it first (Settings → Worktrees)."
        ));
    }

    // Stop the session's PTYs; the primary conversation resumes under the issue
    // key. Companion agents are consumed with the session — the issue adopts one
    // conversation, so theirs are forgotten rather than left pointing at a
    // workspace nothing can open.
    discard_agents(&state, &list[pos].workspace_ids());
    for agent in &list[pos].agents {
        let _ = forget_session_id(&agent.id);
    }

    // Rename the branch to the issue convention (renames don't touch the cwd).
    let old_branch = format!("workspace/{}", crate::helpers::slugify(&id));
    let new_branch = format!("workspace/{}", crate::helpers::slugify(&issue_key));
    let out = std::process::Command::new("git")
        .args(["branch", "-m", &old_branch, &new_branch])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git branch rename failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Couldn't rename the session branch: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    crate::commands::repos::adopt_workspace_dir(&issue_key, &dirname, &repo)?;
    crate::commands::agent::move_session_id(&id, &issue_key)?;

    list.remove(pos);
    save(&list)
}
