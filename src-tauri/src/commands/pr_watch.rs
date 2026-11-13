//! The rail's view of a workspace's pull requests: which PRs it raised
//! (`github::links`) and each one's live discussion (`github::thread`).
//!
//! Both shell out to `gh`/`git` and are polled, so they run off the main thread
//! (`spawn_blocking`) — a sync command would stall the UI for every `gh` call.

use crate::commands::workspace::locate;
use crate::github::{links, thread::PrThread};

/// PR URLs a workspace's agent raised or mentioned, most relevant first. Empty
/// (not an error) when the workspace has no repo yet. A session in a sandbox has
/// no checkout here, so its PRs are its branch's on GitHub.
#[tauri::command]
pub async fn workspace_prs(workspace_id: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // A ticket in a sandbox has no worktree here, even if it has a repo assigned.
        let remote = crate::commands::issue_host::of_issue(&workspace_id)
            .and_then(|_| crate::commands::session_host::remote_prs(&workspace_id));
        remote
            .or_else(|| locate(&workspace_id).map(|(cwd, ids)| links::discover(&cwd, &ids)))
            .or_else(|| crate::commands::session_host::remote_prs(&workspace_id))
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
