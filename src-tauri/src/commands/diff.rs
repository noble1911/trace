//! Diff commands. Show the agent's worktree changes vs the repo's
//! `origin/<default-branch>`: a numstat summary for the file tree, plus
//! per-file unified diffs parsed into hunks for the diff viewer.

use std::process::Command;

use serde::Serialize;
use tauri::State;

use crate::git;
use crate::helpers::slugify;
use crate::state::AppState;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub path: String,
    pub add: u32,
    pub del: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffSummary {
    /// The ref we diffed against, e.g. `origin/main`.
    pub base: String,
    pub files: Vec<FileSummary>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// "ctx" (context) | "add" | "del"
    pub kind: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub add: u32,
    pub del: u32,
    pub hunks: Vec<Hunk>,
}

/// Resolve `(repo, work_dir)` for a workspace's diff. Board agents have an
/// isolated worktree at `.worktrees/<slug>`; exploratory sessions run in the
/// repo root and have none, so we fall back to the repo itself. Returns
/// `(repo, work_dir)` where the diff is computed in `work_dir`.
fn work_dir_for(state: &AppState, workspace_id: &str) -> Result<(String, String), String> {
    let repo = state
        .repo_path
        .read()
        .clone()
        .ok_or_else(|| "Choose a repository folder in Settings first.".to_string())?;
    let worktree = format!("{repo}/.worktrees/{}", slugify(workspace_id));
    if std::path::Path::new(&worktree).exists() {
        Ok((repo, worktree))
    } else {
        // No worktree → exploratory session working directly in the repo root.
        Ok((repo.clone(), repo))
    }
}

fn base_ref(repo: &str) -> String {
    format!("origin/{}", git::get_default_branch(repo))
}

/// File-list summary: every path that differs from the base, with line counts.
/// Includes committed and uncommitted changes in the worktree.
#[tauri::command]
pub fn git_diff_summary(
    state: State<'_, AppState>,
    issue_key: String,
) -> Result<DiffSummary, String> {
    let (repo, worktree) = work_dir_for(&state, &issue_key)?;
    let base = base_ref(&repo);
    let out = Command::new("git")
        .args(["diff", "--numstat", &base])
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("git diff --numstat failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git diff failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut files = Vec::new();
    for line in text.lines() {
        // numstat is "<add>\t<del>\t<path>"; binary files emit "-\t-\t<path>".
        let mut it = line.splitn(3, '\t');
        let add_s = it.next().unwrap_or("0");
        let del_s = it.next().unwrap_or("0");
        let path = match it.next() {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => continue,
        };
        files.push(FileSummary {
            path,
            add: add_s.parse().unwrap_or(0),
            del: del_s.parse().unwrap_or(0),
        });
    }
    Ok(DiffSummary { base, files })
}

/// Per-file unified diff parsed into hunks for the diff viewer.
#[tauri::command]
pub fn git_diff_file(
    state: State<'_, AppState>,
    issue_key: String,
    path: String,
) -> Result<FileDiff, String> {
    let (repo, worktree) = work_dir_for(&state, &issue_key)?;
    let base = base_ref(&repo);
    let out = Command::new("git")
        .args(["diff", "--no-color", &base, "--", &path])
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("git diff failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git diff failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_unified(&path, &text))
}

/// Parse the standard `git diff` output for a single file into structured hunks.
/// Pre-hunk metadata lines (`diff --git`, `index`, `---`, `+++`) are skipped.
fn parse_unified(path: &str, text: &str) -> FileDiff {
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut add = 0u32;
    let mut del = 0u32;
    let mut current: Option<Hunk> = None;
    let mut old_no = 0u32;
    let mut new_no = 0u32;

    for line in text.lines() {
        if line.starts_with("@@") {
            if let Some(h) = current.take() {
                hunks.push(h);
            }
            let (a, b) = parse_hunk_header(line);
            old_no = a;
            new_no = b;
            current = Some(Hunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }

        let Some(h) = current.as_mut() else {
            continue; // pre-hunk metadata
        };

        if let Some(rest) = line.strip_prefix('+') {
            if rest.starts_with("++") {
                continue; // `+++ b/path` header line
            }
            h.lines.push(DiffLine {
                kind: "add".into(),
                old_no: None,
                new_no: Some(new_no),
                text: rest.to_string(),
            });
            new_no += 1;
            add += 1;
        } else if let Some(rest) = line.strip_prefix('-') {
            if rest.starts_with("--") {
                continue; // `--- a/path` header line
            }
            h.lines.push(DiffLine {
                kind: "del".into(),
                old_no: Some(old_no),
                new_no: None,
                text: rest.to_string(),
            });
            old_no += 1;
            del += 1;
        } else if let Some(rest) = line.strip_prefix(' ') {
            h.lines.push(DiffLine {
                kind: "ctx".into(),
                old_no: Some(old_no),
                new_no: Some(new_no),
                text: rest.to_string(),
            });
            old_no += 1;
            new_no += 1;
        }
        // `\ No newline at end of file` and similar — drop.
    }
    if let Some(h) = current.take() {
        hunks.push(h);
    }

    FileDiff {
        path: path.to_string(),
        add,
        del,
        hunks,
    }
}

/// `@@ -a,b +c,d @@ ...` → (a, c). Defaults to (1, 1) on malformed input.
fn parse_hunk_header(line: &str) -> (u32, u32) {
    let mut old_start = 1u32;
    let mut new_start = 1u32;
    for token in line.split_whitespace() {
        if let Some(rest) = token.strip_prefix('-') {
            old_start = rest
                .split(',')
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(1);
        } else if let Some(rest) = token.strip_prefix('+') {
            new_start = rest
                .split(',')
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or(1);
        }
    }
    (old_start, new_start)
}
