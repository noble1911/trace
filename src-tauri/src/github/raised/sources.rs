//! Which workspaces the Pull requests page looks in, and where each one's PRs
//! can be found: its repo, the branch that is its own (if any), its logs.
//!
//! The page asks every minute about every ticket trace ever started, most of
//! them long finished, so this is built to be cheap per ticket: the config files
//! are read once per call, a ticket whose worktree is gone costs no `git` at all,
//! and where a conversation's log lives is remembered between calls.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::Workspace;
use crate::claude::conversations;
use crate::commands::{repos, session, workspace};

/// How long a conversation with no log yet (pinned, never written) is left
/// before the projects folder is searched for it again.
const MISSING_LOG_RETRY: Duration = Duration::from_secs(600);

/// `ids` (sessions, session agents, live tickets) plus every started ticket,
/// each once, resolved to where its PRs can be found. One without a repo is
/// skipped.
pub fn workspaces(ids: Vec<String>) -> Vec<Workspace> {
    let sessions = session::load();
    let owner_of = |id: &str| {
        sessions
            .iter()
            .find(|s| s.id == id || s.agents.iter().any(|a| a.id == id))
    };
    let pinned: HashMap<String, String> = repos::assigned_workspaces().into_iter().collect();
    let overrides = repos::dir_overrides();
    let conversation_ids = conversations::all_session_ids();
    let mut default_branch: HashMap<String, String> = HashMap::new();

    // A session that adopted a dir is pinned too; it isn't a ticket.
    let tickets = pinned
        .keys()
        .filter(|id| crate::activity::looks_like_issue_key(id) && owner_of(id).is_none())
        .cloned();
    let mut seen = HashSet::new();
    let all: Vec<String> = ids
        .into_iter()
        .chain(tickets)
        .filter(|id| seen.insert(id.clone()))
        .collect();

    let mut out = Vec::new();
    for id in all {
        let found = if owner_of(&id).is_some() {
            of_session(&id)
        } else {
            let Some(repo) = pinned
                .get(&id)
                .cloned()
                .or_else(|| repos::repo_for(&id).ok())
            else {
                continue;
            };
            let dirname = overrides
                .get(&id)
                .cloned()
                .unwrap_or_else(|| crate::helpers::slugify(&id));
            let worktree = crate::platform::paths::worktree_dir(&repo, &dirname);
            Some(of_ticket(&id, repo, &worktree, conversation_ids.get(&id)))
        };
        let Some((mut ws, cwd, conversation_ids)) = found else {
            continue;
        };
        if let Some(branch) = &ws.branch {
            let default = default_branch
                .entry(ws.repo.clone())
                .or_insert_with(|| crate::git::get_default_branch(&ws.repo));
            if branch == default {
                ws.branch = None;
            }
        }
        ws.logs = conversation_ids
            .iter()
            .filter_map(|c| log_file(c, &cwd))
            .collect();
        out.push(ws);
    }
    out
}

/// A session, or one of its agents: they share its checkout, and every one of
/// their conversations counts. A session's branch is its own wherever it runs.
fn of_session(id: &str) -> Option<(Workspace, String, Vec<String>)> {
    let (cwd, conversation_ids) = workspace::locate(id)?;
    let (repo, branch) = workspace::checkout_of(&cwd);
    Some((blank(id, repo, branch), cwd, conversation_ids))
}

/// A ticket. Its branch counts only while its own worktree exists: once that's
/// cleaned up it runs from the repo root, whose branch is whatever the user has
/// out — checked by the directory, not by comparing two spellings of a path.
fn of_ticket(
    id: &str,
    repo: String,
    worktree: &str,
    conversation: Option<&String>,
) -> (Workspace, String, Vec<String>) {
    let has_worktree = Path::new(worktree).is_dir();
    let branch = has_worktree
        .then(|| workspace::branch_of(worktree))
        .flatten();
    let cwd = if has_worktree {
        worktree.to_string()
    } else {
        repo.clone()
    };
    let conversation_ids = conversation.cloned().into_iter().collect();
    (blank(id, repo, branch), cwd, conversation_ids)
}

fn blank(id: &str, repo: String, branch: Option<String>) -> Workspace {
    Workspace {
        id: id.to_string(),
        repo,
        branch,
        logs: Vec::new(),
    }
}

/// Where each conversation's log was found, or when it last wasn't.
static LOGS: Mutex<Option<HashMap<String, Result<PathBuf, Instant>>>> = Mutex::new(None);

/// Conversation `id`'s log. A found one is reused while it's still there, so a
/// finished ticket's log isn't searched for across every Claude project on each
/// call; a missing one is searched for again only after [`MISSING_LOG_RETRY`].
fn log_file(id: &str, cwd: &str) -> Option<PathBuf> {
    let known = {
        let guard = LOGS.lock().unwrap_or_else(|p| p.into_inner());
        guard.as_ref().and_then(|m| m.get(id).cloned())
    };
    match known {
        Some(Ok(path)) if path.is_file() => return Some(path),
        Some(Err(at)) if at.elapsed() < MISSING_LOG_RETRY => return None,
        _ => {}
    }
    let found = conversations::conversation_file(id, Some(cwd));
    let mut guard = LOGS.lock().unwrap_or_else(|p| p.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .insert(id.to_string(), found.clone().ok_or_else(Instant::now));
    found
}
