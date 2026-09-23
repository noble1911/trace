//! The rail's view of a workspace's pull requests: which PRs it raised
//! (`github::links`) and each one's live discussion (`github::thread`).
//!
//! Both shell out to `gh`/`git` and are polled, so they run off the main thread
//! (`spawn_blocking`) — a sync command would stall the UI for every `gh` call.

use crate::claude::conversations::session_id_for;
use crate::github::{links, thread::PrThread};

/// Where a workspace runs and which Claude conversations belong to it. A
/// session's companions share its worktree, so all their conversations count.
fn locate(workspace_id: &str) -> Option<(String, Vec<String>)> {
    if let Some(session) = crate::commands::session::owning_session(workspace_id) {
        let cwd = crate::commands::session::session_cwd(&session.id, false).ok()?;
        let mut owners = vec![session.id.clone()];
        owners.extend(session.agents.iter().map(|a| a.id.clone()));
        return Some((
            cwd,
            owners.iter().filter_map(|o| session_id_for(o)).collect(),
        ));
    }
    let repo = crate::commands::repos::repo_for(workspace_id).ok()?;
    let worktree = crate::commands::repos::workspace_dir(&repo, workspace_id);
    let cwd = if std::path::Path::new(&worktree).exists() {
        worktree
    } else {
        repo
    };
    Some((cwd, session_id_for(workspace_id).into_iter().collect()))
}

/// PR URLs a workspace's agent raised or mentioned, most relevant first. Empty
/// (not an error) when the workspace has no repo yet.
#[tauri::command]
pub async fn workspace_prs(workspace_id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        locate(&workspace_id)
            .map(|(cwd, ids)| links::discover(&cwd, &ids))
            .unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
}

/// One PR's state, checks, reviews and comments (with edit times).
#[tauri::command]
pub async fn pr_thread(workspace_id: String, pr_url: String) -> Result<PrThread, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cwd = locate(&workspace_id)
            .map(|(cwd, _)| cwd)
            .or_else(|| dirs::home_dir().map(|h| h.to_string_lossy().into_owned()))
            .ok_or("No directory to run gh from")?;
        crate::github::thread::fetch(&cwd, &pr_url)
    })
    .await
    .map_err(|e| e.to_string())?
}
