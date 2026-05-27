//! Git worktree operations. Each agent runs in an isolated worktree so parallel
//! sessions never collide. Adapted from the previous project.

use std::path::PathBuf;
use std::process::Command;

pub fn is_git_repo(path: &str) -> bool {
    Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Resolve the repo's default branch (origin/HEAD), falling back to `main`.
pub fn get_default_branch(repo_path: &str) -> String {
    let output = Command::new("git")
        .args(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"])
        .current_dir(repo_path)
        .output();
    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .trim()
            .replace("origin/", ""),
        _ => "main".to_string(),
    }
}

/// "clean" if safe to mutate, else "busy:<reason>" — a rebase/merge/cherry-pick/
/// revert in progress would make worktree/branch ops unsafe.
pub fn git_busy_check(repo_path: &str) -> String {
    let git_dir = match Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(repo_path)
        .output()
    {
        Ok(o) if o.status.success() => {
            let dir = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if dir.starts_with('/') {
                PathBuf::from(dir)
            } else {
                PathBuf::from(repo_path).join(dir)
            }
        }
        _ => return "error:not_a_git_repo".to_string(),
    };

    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return "busy:rebase".to_string();
    }
    if git_dir.join("MERGE_HEAD").exists() {
        return "busy:merge".to_string();
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return "busy:cherry-pick".to_string();
    }
    if git_dir.join("REVERT_HEAD").exists() {
        return "busy:revert".to_string();
    }
    "clean".to_string()
}

/// Create a worktree at `worktree_path` on a new `branch` cut from
/// `origin/<default_branch>`. Idempotent: if the path already exists it's reused.
pub fn create_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch: &str,
    default_branch: &str,
) -> Result<(), String> {
    if PathBuf::from(worktree_path).exists() {
        return Ok(());
    }

    let fetch = Command::new("git")
        .args(["fetch", "origin", default_branch])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to fetch origin: {e}"))?;
    if !fetch.status.success() {
        return Err(format!(
            "Git fetch failed: {}",
            String::from_utf8_lossy(&fetch.stderr)
        ));
    }

    let start_point = format!("origin/{default_branch}");
    let output = Command::new("git")
        .args(["worktree", "add", "-b", branch, worktree_path, &start_point])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to create worktree: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git worktree failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Remove a worktree (force). Safe to call if it's already gone.
pub fn remove_worktree(repo_path: &str, worktree_path: &str) -> Result<(), String> {
    let output = Command::new("git")
        .args(["worktree", "remove", worktree_path, "--force"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("is not a working tree") {
            return Err(format!("Git worktree remove failed: {stderr}"));
        }
    }
    Ok(())
}
