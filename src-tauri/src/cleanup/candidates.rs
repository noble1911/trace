//! What a sweep considers: every worktree on disk that belongs to a scratch
//! session or a ticket, with the last time anything happened in it.
//!
//! Scheduled prompts' worktrees are never candidates — a prompt owns its
//! checkout for as long as it exists (`worktrees::dir_shared` excludes them,
//! and the sessions continuing one of their runs).

use std::collections::HashSet;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::claude::conversations::conversation_path;
use crate::commands::repos::{assigned_workspaces, default_repo, workspace_dirname};
use crate::commands::worktrees::{dir_shared, git_out};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkspaceKind {
    Session,
    Ticket,
}

pub struct Candidate {
    pub workspace_id: String,
    pub kind: WorkspaceKind,
    /// What the UI shows: the session's title, or the issue key.
    pub label: String,
    pub repo: String,
    pub path: String,
    /// Directory name under `.worktrees/` — what `running_slugs` reports.
    pub dirname: String,
    /// In the sessions recycle bin (always false for tickets).
    pub archived: bool,
    /// Epoch secs of the last sign of life (see `last_active`).
    pub last_active: u64,
}

/// Every session- and ticket-owned worktree that exists on disk.
pub fn collect() -> Vec<Candidate> {
    let sessions = crate::commands::session::load();
    let session_ids: HashSet<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for s in &sessions {
        // Legacy sessions run in the repo root — there's no checkout to delete.
        if !s.worktree {
            continue;
        }
        let Some(repo) = s.repo.clone().or_else(default_repo) else {
            continue;
        };
        let owner = Owner { id: &s.id, label: &s.title, kind: WorkspaceKind::Session };
        push(&mut out, &mut seen, owner, repo, s.archived_at);
    }
    for (id, repo) in assigned_workspaces() {
        if session_ids.contains(id.as_str()) || !crate::activity::looks_like_issue_key(&id) {
            continue;
        }
        let owner = Owner { id: &id, label: &id, kind: WorkspaceKind::Ticket };
        push(&mut out, &mut seen, owner, repo, None);
    }
    out
}

struct Owner<'a> {
    id: &'a str,
    label: &'a str,
    kind: WorkspaceKind,
}

fn push(
    out: &mut Vec<Candidate>,
    seen: &mut HashSet<String>,
    owner: Owner,
    repo: String,
    archived_at: Option<u64>,
) {
    let dirname = workspace_dirname(owner.id);
    let path = format!("{repo}/.worktrees/{dirname}");
    if dirname.is_empty() || !Path::new(&path).is_dir() || !seen.insert(path.clone()) {
        return;
    }
    // Another workspace lives here too (a scheduled prompt, or whoever adopted it).
    if dir_shared(owner.id, &dirname) {
        return;
    }
    out.push(Candidate {
        workspace_id: owner.id.to_string(),
        kind: owner.kind,
        label: owner.label.to_string(),
        last_active: last_active(&path, archived_at),
        repo,
        path,
        dirname,
        archived: archived_at.is_some(),
    });
}

/// The latest sign of life in a worktree: its directory changing (creation,
/// top-level files), its HEAD commit, any Claude transcript rooted there, or the
/// moment it was archived. Deliberately not the git index — trace's own status
/// scans rewrite it, which would keep every worktree "active" forever.
fn last_active(path: &str, archived_at: Option<u64>) -> u64 {
    let head_commit = git_out(path, &["log", "-1", "--format=%ct"])
        .and_then(|s| s.trim().parse::<u64>().ok());
    [mtime(Path::new(path)), head_commit, newest_transcript(path), archived_at]
        .into_iter()
        .flatten()
        .max()
        .unwrap_or(0)
}

/// Newest `.jsonl` in Claude's project dir for `cwd` — every conversation an
/// agent (or a companion, or a reset) ever had there, not just the current id.
fn newest_transcript(cwd: &str) -> Option<u64> {
    let dir = conversation_path(cwd, "_")?.parent()?.to_path_buf();
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|ext| ext == "jsonl"))
        .filter_map(|p| mtime(&p))
        .max()
}

fn mtime(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_secs())
}
