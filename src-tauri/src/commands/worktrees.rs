//! Worktree housekeeping. Merged issues leave `.worktrees/<slug>` checkouts
//! and `workspace/<slug>` branches behind forever — these commands list them
//! (with merged/dirty/running status) and remove them safely.

use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::git;
use crate::helpers::slugify;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub repo: String,
    pub path: String,
    /// Directory name under `.worktrees/` — the issue's slug.
    pub name: String,
    pub branch: Option<String>,
    /// Branch is an ancestor of origin/<default> — safe to delete.
    pub merged: bool,
    /// Uncommitted changes in the worktree (removal would lose work).
    pub dirty: bool,
    /// A live PTY is rooted here — removal is blocked.
    pub running: bool,
}

fn git_out(dir: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).current_dir(dir).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        None
    }
}

/// Parse `git worktree list --porcelain` into (path, branch) pairs.
fn parse_worktree_list(porcelain: &str) -> Vec<(String, Option<String>)> {
    let mut res = Vec::new();
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;
    for line in porcelain.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if let Some(p) = path.take() {
                res.push((p, branch.take()));
            }
            branch = None;
        } else if let Some(p) = line.strip_prefix("worktree ") {
            path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            branch = Some(b.to_string());
        }
    }
    res
}

/// Branch names already contained in the repo's default branch — one
/// `git branch --merged` per repo instead of a merge-base probe per worktree.
/// Prefers the remote-tracking ref (what's actually merged); falls back to
/// the local default branch when there's no remote.
fn merged_branches(repo: &str) -> std::collections::HashSet<String> {
    let default = git::get_default_branch(repo);
    for base in [format!("origin/{default}"), default] {
        if let Some(out) = git_out(repo, &["branch", "--merged", &base, "--format=%(refname:short)"])
        {
            return out
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
        }
    }
    Default::default()
}

fn is_dirty(worktree: &str) -> bool {
    git_out(worktree, &["status", "--porcelain"]).is_none_or(|s| !s.trim().is_empty())
}

/// Worktree dir names with a live PTY (board agents + their `term:` shells).
/// Resolved through the dirname helper so adopted dirs match correctly.
fn running_slugs(state: &AppState) -> Vec<String> {
    state
        .pty_sessions
        .lock()
        .keys()
        .map(|k| crate::commands::repos::workspace_dirname(k.strip_prefix("term:").unwrap_or(k)))
        .collect()
}

/// Remove the worktree (and branch) backing `workspace_id`, wherever it
/// lives. Forced and best-effort — callers are deleting the workspace
/// itself, so leftover changes there are disposable.
pub(crate) fn remove_for_workspace(workspace_id: &str) {
    let dirname = crate::commands::repos::workspace_dirname(workspace_id);
    let slug = slugify(workspace_id);
    if dirname.is_empty() {
        return;
    }
    for repo in crate::commands::repos::all_repos() {
        let path = format!("{repo}/.worktrees/{dirname}");
        if !std::path::Path::new(&path).exists() {
            continue;
        }
        let _ = Command::new("git")
            .args(["worktree", "remove", "--force", &path])
            .current_dir(&repo)
            .output();
        let _ = Command::new("git")
            .args(["branch", "-D", &format!("workspace/{slug}")])
            .current_dir(&repo)
            .output();
    }
}

/// Every `.worktrees/` checkout across the configured repos, with status.
/// Async + spawn_blocking: sync commands run on the main thread, and the git
/// scans here (especially `git status` on big repos) take seconds — this must
/// never freeze the UI.
#[tauri::command]
pub async fn list_worktrees(state: State<'_, AppState>) -> Result<Vec<WorktreeInfo>, String> {
    // Snapshot the running set before leaving the thread — State isn't Send.
    let running = running_slugs(&state);
    tauri::async_runtime::spawn_blocking(move || collect_worktrees(&running))
        .await
        .map_err(|e| format!("worktree scan failed: {e}"))
}

fn collect_worktrees(running: &[String]) -> Vec<WorktreeInfo> {
    let mut out = Vec::new();
    for repo in crate::commands::repos::all_repos() {
        let marker = format!("{repo}/.worktrees/");
        let Some(listing) = git_out(&repo, &["worktree", "list", "--porcelain"]) else {
            continue;
        };
        let entries: Vec<(String, Option<String>)> = parse_worktree_list(&listing)
            .into_iter()
            .filter(|(p, _)| p.starts_with(&marker))
            .collect();
        if entries.is_empty() {
            continue;
        }
        // One merged-set per repo, and the per-worktree `git status` scans
        // (the dominant cost) fan out in parallel.
        let merged = merged_branches(&repo);
        let dirt: Vec<bool> = std::thread::scope(|s| {
            let handles: Vec<_> = entries
                .iter()
                .map(|(path, _)| s.spawn(move || is_dirty(path)))
                .collect();
            // A panicked probe counts as dirty — the safe side (requires confirm).
            handles.into_iter().map(|h| h.join().unwrap_or(true)).collect()
        });
        for ((path, branch), dirty) in entries.into_iter().zip(dirt) {
            let name = path.rsplit('/').next().unwrap_or(&path).to_string();
            out.push(WorktreeInfo {
                merged: branch.as_deref().map(|b| merged.contains(b)).unwrap_or(false),
                dirty,
                running: running.contains(&name),
                repo: repo.clone(),
                path,
                name,
                branch,
            });
        }
    }
    out
}

/// Remove a worktree (and its branch). Refuses while an agent runs in it,
/// and refuses dirty worktrees unless `force` — that's the UI's confirm step.
/// Async for the same reason as the listing: git must not block the UI.
#[tauri::command]
pub async fn remove_worktree(
    state: State<'_, AppState>,
    repo: String,
    path: String,
    branch: Option<String>,
    force: bool,
) -> Result<(), String> {
    if !path.starts_with(&format!("{repo}/.worktrees/")) {
        return Err("Not a trace-managed worktree.".to_string());
    }
    let name = path.rsplit('/').next().unwrap_or("").to_string();
    if running_slugs(&state).contains(&name) {
        return Err("An agent is running in this worktree — stop it first.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || remove_blocking(&repo, &path, branch, force))
        .await
        .map_err(|e| format!("worktree removal failed: {e}"))?
}

fn remove_blocking(
    repo: &str,
    path: &str,
    branch: Option<String>,
    force: bool,
) -> Result<(), String> {
    if !force && is_dirty(path) {
        return Err("Worktree has uncommitted changes.".to_string());
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(path);
    let out = Command::new("git")
        .args(&args)
        .current_dir(repo)
        .output()
        .map_err(|e| format!("git worktree remove failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    // Branch deletion is best-effort — the checkout is gone either way.
    if let Some(branch) = branch {
        let _ = Command::new("git")
            .args(["branch", "-D", &branch])
            .current_dir(repo)
            .output();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_worktree_list;

    #[test]
    fn parses_porcelain_blocks() {
        let porcelain = "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n\nworktree /repo/.worktrees/trace-12\nHEAD bbb\nbranch refs/heads/workspace/trace-12\n\nworktree /repo/.worktrees/detached\nHEAD ccc\ndetached\n";
        let parsed = parse_worktree_list(porcelain);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0], ("/repo".into(), Some("main".into())));
        assert_eq!(
            parsed[1],
            ("/repo/.worktrees/trace-12".into(), Some("workspace/trace-12".into()))
        );
        assert_eq!(parsed[2], ("/repo/.worktrees/detached".into(), None));
    }
}
