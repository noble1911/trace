//! Where a workspace lives on disk, for the detail views' headers and rails.
//!
//! A workspace id is an issue key, a session id, or a session companion's id;
//! `locate` maps any of them to the directory its agent runs in and the Claude
//! conversations that belong to it.

use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;

use crate::claude::conversations::session_id_for;

/// Where a workspace runs and which Claude conversations belong to it. A
/// session's companions share its worktree, so all their conversations count.
/// `None` when it has no repo yet.
pub(crate) fn locate(workspace_id: &str) -> Option<(String, Vec<String>)> {
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

/// What the header/rail show about a workspace's checkout.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    /// The repo's root (main checkout).
    pub repo: String,
    /// Where the agent runs: the worktree, or the repo root before one exists.
    pub cwd: String,
    /// Whether `cwd` is a dedicated worktree (vs the repo root).
    pub is_worktree: bool,
    /// The branch actually checked out — agents sometimes switch off
    /// `workspace/<slug>`, so this is read from git, not derived.
    pub branch: Option<String>,
}

fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Repo, cwd and live branch for a workspace; `None` before it has a repo.
#[tauri::command]
pub async fn workspace_info(workspace_id: String) -> Result<Option<WorkspaceInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (cwd, _) = locate(&workspace_id)?;
        // A worktree's common dir is the main repo's `.git`; its parent is the repo.
        let repo = git(
            &cwd,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )
        .and_then(|d| {
            std::path::Path::new(&d)
                .parent()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| cwd.clone());
        let branch = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).filter(|b| b != "HEAD");
        Some(WorkspaceInfo {
            is_worktree: cwd != repo,
            repo,
            cwd,
            branch,
        })
    })
    .await
    .map_err(|e| e.to_string())
}

/// One row of the Sessions list: where the session works and its PR.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverview {
    pub id: String,
    /// Repo root path.
    pub repo: String,
    pub branch: Option<String>,
    pub pr: Option<crate::github::repo_prs::PrRef>,
}

/// Branch + PR for many sessions at once: a local `git` read per session, then
/// ONE `gh pr list` per repo matched by branch — a page of 20 sessions costs a
/// couple of GitHub calls, not twenty. Sessions without a repo are skipped.
#[tauri::command]
pub async fn sessions_overview(ids: Vec<String>) -> Result<Vec<SessionOverview>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut rows: Vec<SessionOverview> = Vec::new();
        for id in ids {
            let Some((cwd, _)) = locate(&id) else {
                continue;
            };
            let repo = git(
                &cwd,
                &["rev-parse", "--path-format=absolute", "--git-common-dir"],
            )
            .and_then(|d| {
                std::path::Path::new(&d)
                    .parent()
                    .map(|p| p.to_string_lossy().into_owned())
            })
            .unwrap_or(cwd.clone());
            let branch = git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).filter(|b| b != "HEAD");
            rows.push(SessionOverview {
                id,
                repo,
                branch,
                pr: None,
            });
        }
        // The default branch is every legacy root session's — its PRs aren't theirs.
        let mut prs_by_repo: HashMap<String, HashMap<String, crate::github::repo_prs::PrRef>> =
            HashMap::new();
        for row in &mut rows {
            let Some(branch) = row.branch.clone() else {
                continue;
            };
            if branch == crate::git::get_default_branch(&row.repo) {
                continue;
            }
            let prs = prs_by_repo
                .entry(row.repo.clone())
                .or_insert_with(|| crate::github::repo_prs::by_branch(&row.repo));
            row.pr = prs.get(&branch).cloned();
        }
        rows
    })
    .await
    .map_err(|e| e.to_string())
}
