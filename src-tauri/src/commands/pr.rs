//! Pull-request commands. Shells out to `git` and `gh` from the issue's
//! worktree so the user's existing `gh auth` and ssh credentials apply without
//! any in-app OAuth dance.

use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::helpers::slugify;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaisedPr {
    pub url: String,
}

fn read_repo(state: &AppState) -> Result<String, String> {
    state
        .repo_path
        .read()
        .clone()
        .ok_or_else(|| "Choose a repository folder in Settings first.".to_string())
}

/// Raise a PR for the given issue's worktree. Idempotent: if the branch is
/// already pushed and a PR exists, returns that PR's URL instead of erroring.
#[tauri::command]
pub fn raise_pr(
    state: State<'_, AppState>,
    issue_key: String,
    title: String,
    body: String,
) -> Result<RaisedPr, String> {
    let repo = read_repo(&state)?;
    let slug = slugify(&issue_key);
    let worktree = format!("{repo}/.worktrees/{slug}");
    let branch = format!("workspace/{slug}");

    if !std::path::Path::new(&worktree).exists() {
        return Err(format!(
            "No worktree for {issue_key} — start a Claude session on this issue first."
        ));
    }

    // Push the branch. `-u` sets upstream on the first push; if upstream is
    // already set, fall through to a plain push.
    let push = Command::new("git")
        .args(["push", "-u", "origin", &branch])
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("git push failed to start: {e}"))?;
    if !push.status.success() {
        let stderr = String::from_utf8_lossy(&push.stderr);
        // Already-set upstream is harmless; retry without -u.
        let retry = Command::new("git")
            .args(["push", "origin", &branch])
            .current_dir(&worktree)
            .output()
            .map_err(|e| format!("git push failed: {e}"))?;
        if !retry.status.success() {
            return Err(format!(
                "git push failed: {}",
                String::from_utf8_lossy(&retry.stderr).trim()
            ));
        }
        // First push failed but the retry succeeded — drop the noisy stderr.
        let _ = stderr;
    }

    // Create the PR. `gh` reads the title/body via stdin to avoid shell quoting
    // headaches for multi-line bodies.
    let create = Command::new("gh")
        .args(["pr", "create", "--title", &title, "--body", &body, "--head", &branch])
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("gh pr create failed to start: {e}"))?;

    if create.status.success() {
        let url = String::from_utf8_lossy(&create.stdout).trim().to_string();
        return Ok(RaisedPr { url });
    }

    // Common case: PR already exists for this branch — look it up.
    let stderr = String::from_utf8_lossy(&create.stderr);
    if stderr.contains("already exists") {
        let view = Command::new("gh")
            .args(["pr", "view", "--head", &branch, "--json", "url", "--jq", ".url"])
            .current_dir(&worktree)
            .output()
            .map_err(|e| format!("gh pr view failed: {e}"))?;
        if view.status.success() {
            let url = String::from_utf8_lossy(&view.stdout).trim().to_string();
            if !url.is_empty() {
                return Ok(RaisedPr { url });
            }
        }
    }
    Err(format!("gh pr create failed: {}", stderr.trim()))
}

/// Merge a PR by URL. `method` is `squash` | `merge` | `rebase` (default squash).
#[tauri::command]
pub fn merge_pr(
    state: State<'_, AppState>,
    pr_url: String,
    method: Option<String>,
) -> Result<(), String> {
    let repo = read_repo(&state)?;
    let flag = match method.as_deref().unwrap_or("squash") {
        "merge" => "--merge",
        "rebase" => "--rebase",
        _ => "--squash",
    };
    let out = Command::new("gh")
        .args(["pr", "merge", &pr_url, flag, "--delete-branch"])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("gh pr merge failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "gh pr merge failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}
