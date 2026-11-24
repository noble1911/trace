//! Git worktree operations. Each agent runs in an isolated worktree so parallel
//! sessions never collide. Adapted from the previous project.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn is_git_repo(path: &str) -> bool {
    crate::claude::discovery::command("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Resolve the repo's default branch (origin/HEAD), falling back to `main`.
pub fn get_default_branch(repo_path: &str) -> String {
    let output = crate::claude::discovery::command("git")
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
    let git_dir = match crate::claude::discovery::command("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(repo_path)
        .output()
    {
        Ok(o) if o.status.success() => {
            let dir = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if std::path::Path::new(&dir).is_absolute() {
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

    let fetch = crate::claude::discovery::command("git")
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

    // A branch can outlive its checkout — auto-cleanup (`cleanup::sweep`) keeps
    // branches holding unpushed commits. Check it back out rather than failing
    // on `-b`, so restarting the workspace picks its committed work back up.
    let branch_exists = crate::claude::discovery::command("git")
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ])
        .current_dir(repo_path)
        .status()
        .is_ok_and(|s| s.success());
    exclude_worktrees_dir(repo_path);
    let start_point = format!("origin/{default_branch}");
    let args: Vec<&str> = if branch_exists {
        vec!["worktree", "add", worktree_path, branch]
    } else {
        vec!["worktree", "add", "-b", branch, worktree_path, &start_point]
    };
    let output = crate::claude::discovery::command("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to create worktree: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Git worktree failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    // Plugins installed "Just me" on the repo live in an uncommitted file the new
    // branch doesn't bring: carry it over before the agent starts. Best-effort.
    let _ = crate::skills::project::carry_local_settings(
        Path::new(repo_path),
        Path::new(worktree_path),
    );
    // The repo's setup hooks (`npm install`, copying `.env`), on their own thread.
    crate::repo_catalog::setup::after_worktree_created(repo_path, worktree_path);
    Ok(())
}

/// Move an existing worktree of `repo_path` from `from` to `to` (`git worktree
/// move`), keeping its branch, commits and uncommitted changes. How trace adopts
/// a worktree another tool made (`conductor_import::adopt`) into `.worktrees/`.
pub fn move_worktree(repo_path: &str, from: &str, to: &str) -> Result<(), String> {
    if Path::new(to).exists() {
        return Err(format!("{to} already exists."));
    }
    exclude_worktrees_dir(repo_path);
    if let Some(parent) = Path::new(to).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Couldn't make {}: {e}", parent.display()))?;
    }
    let out = crate::claude::discovery::command("git")
        .args(["worktree", "move", from, to])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Failed to move the worktree: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Git couldn't move the worktree: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Keep `.worktrees/` out of the user's `git status`, since trace creates it inside
/// their repo. Uses `info/exclude` so their tracked `.gitignore` stays untouched.
/// Best-effort: failing here must not stop the worktree being created.
fn exclude_worktrees_dir(repo_path: &str) {
    const ENTRY: &str = ".worktrees/";
    let Ok(out) = crate::claude::discovery::command("git")
        .args(["rev-parse", "--git-path", "info/exclude"])
        .current_dir(repo_path)
        .output()
    else {
        return;
    };
    if !out.status.success() {
        return;
    }
    // Relative to the repo unless the repo is itself a worktree; `join` handles both.
    let path = Path::new(repo_path).join(String::from_utf8_lossy(&out.stdout).trim());
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    if existing.lines().any(|line| line.trim() == ENTRY) {
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{separator}{ENTRY}");
    }
}

#[cfg(test)]
mod tests {
    use super::exclude_worktrees_dir;

    fn git(dir: &str, args: &[&str]) -> std::process::Output {
        crate::claude::discovery::command("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git runs")
    }

    #[test]
    fn exclude_ignores_worktrees_once_and_keeps_existing_rules() {
        let dir = std::env::temp_dir().join(format!("trace-git-{}", crate::helpers::new_id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let repo = dir.to_str().expect("utf-8 path");
        assert!(git(repo, &["init", "-q"]).status.success());
        let exclude = dir.join(".git/info/exclude");
        std::fs::create_dir_all(exclude.parent().expect("parent")).expect("info dir");
        std::fs::write(&exclude, "my-rule").expect("seed exclude");

        exclude_worktrees_dir(repo);
        exclude_worktrees_dir(repo);

        let content = std::fs::read_to_string(&exclude).expect("exclude file");
        assert_eq!(content, "my-rule\n.worktrees/\n");
        assert!(git(repo, &["check-ignore", "-q", ".worktrees/x"])
            .status
            .success());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
