//! One cleanup pass: pick the candidates the user's rules select, hold back
//! any whose removal would lose work, and delete the rest.
//!
//! Deleting means the *checkout* (`git worktree remove`) — that's the disk
//! cost. The session or ticket itself stays, and so does its Claude
//! conversation (keyed by path, which a restart recreates). The branch goes
//! only when every commit on it is merged or pushed; otherwise it's kept, and
//! `git::create_worktree` checks it back out on the next start.

use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;

use super::candidates::{self, Candidate, WorkspaceKind};
use super::settings::CleanupSettings;
use crate::activity::{ActivityInput, ActivityKind, Actor};
use crate::commands::worktrees::{git_out, is_dirty, merged_branches, running_slugs};
use crate::issues::{IssueProvider, Provider, ProviderKind};
use crate::state::AppState;

/// Serializes passes: the hourly runner and "Clean up now" must not both
/// `git worktree remove` the same checkout.
static SWEEPING: Mutex<()> = Mutex::new(());

/// One workspace a pass selected.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupItem {
    pub workspace_id: String,
    pub kind: WorkspaceKind,
    pub label: String,
    pub path: String,
    /// Epoch secs of its last activity.
    pub last_active: u64,
    /// Why it was kept despite qualifying (`None` = removed, or would be).
    pub held: Option<String>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanupReport {
    pub items: Vec<CleanupItem>,
}

/// What a pass needs from `AppState`, snapshotted so the slow part (git, the
/// tracker) runs off the main thread without holding any lock.
pub struct Context {
    providers: HashMap<ProviderKind, Provider>,
    running: Vec<String>,
}

impl Context {
    pub fn snapshot(state: &AppState) -> Self {
        Self {
            providers: state.providers.read().clone(),
            running: running_slugs(state),
        }
    }
}

/// Whether a workspace falls under the rules. The pure core of a pass: `is_done`
/// is only consulted (it's a tracker call) when everything cheaper passed.
pub(crate) fn qualifies(
    settings: &CleanupSettings,
    kind: WorkspaceKind,
    archived: bool,
    idle_secs: u64,
    is_done: impl FnOnce() -> Option<bool>,
) -> bool {
    if idle_secs < settings.after_secs() {
        return false;
    }
    match kind {
        WorkspaceKind::Session => {
            settings.scope.sessions() && (!settings.sessions_only_archived || archived)
        }
        // An unreachable tracker reads as "not done" — never delete on a guess.
        WorkspaceKind::Ticket => {
            settings.scope.tickets() && (!settings.tickets_only_done || is_done() == Some(true))
        }
    }
}

/// What a pass would delete right now, without deleting anything.
pub fn preview(settings: &CleanupSettings, ctx: &Context) -> CleanupReport {
    let items = select(settings, ctx).into_iter().map(|(c, held)| item(c, held)).collect();
    CleanupReport { items }
}

/// Run a pass: delete everything selected and not held, logging each removal
/// to the activity feed.
pub fn apply(app: &AppHandle, settings: &CleanupSettings, ctx: &Context) -> CleanupReport {
    let _guard = SWEEPING.lock().unwrap_or_else(|e| e.into_inner());
    let mut merged: HashMap<String, HashSet<String>> = HashMap::new();
    let mut items = Vec::new();
    for (c, held) in select(settings, ctx) {
        if held.is_some() {
            items.push(item(c, held));
            continue;
        }
        let merged = merged.entry(c.repo.clone()).or_insert_with(|| merged_branches(&c.repo));
        match remove(&c, merged) {
            Ok(branch_kept) => {
                record(app, &c, branch_kept);
                items.push(item(c, None));
            }
            Err(e) => items.push(item(c, Some(e))),
        }
    }
    CleanupReport { items }
}

/// Candidates the rules select, each with the reason it must be kept, if any.
fn select(settings: &CleanupSettings, ctx: &Context) -> Vec<(Candidate, Option<String>)> {
    let now = crate::schedule::now_secs().max(0) as u64;
    candidates::collect()
        .into_iter()
        .filter(|c| {
            let idle = now.saturating_sub(c.last_active);
            qualifies(settings, c.kind, c.archived, idle, || ticket_done(ctx, &c.workspace_id))
        })
        .map(|c| {
            let held = if ctx.running.contains(&c.dirname) {
                Some("an agent is running in it".to_string())
            } else if is_dirty(&c.path) {
                Some("it has uncommitted changes".to_string())
            } else {
                None
            };
            (c, held)
        })
        .collect()
}

/// Whether the ticket's issue is in a Done-category status; `None` when its
/// tracker isn't connected or didn't answer.
fn ticket_done(ctx: &Context, key: &str) -> Option<bool> {
    let provider = ctx.providers.get(&ProviderKind::for_issue_key(key))?;
    let category = tauri::async_runtime::block_on(provider.status_category(key)).ok()?;
    Some(category == "done")
}

/// Remove the checkout, and its branch when nothing on it is unique. Returns
/// whether the branch was kept.
fn remove(c: &Candidate, merged: &HashSet<String>) -> Result<bool, String> {
    let branch = git_out(&c.path, &["symbolic-ref", "--short", "HEAD"])
        .map(|b| b.trim().to_string())
        .filter(|b| b.starts_with("workspace/"));
    // --force only to get past submodules: `select` already held anything dirty.
    let out = Command::new("git")
        .args(["worktree", "remove", "--force", &c.path])
        .current_dir(&c.repo)
        .output()
        .map_err(|e| format!("git worktree remove failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git worktree remove failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let Some(branch) = branch else {
        return Ok(false);
    };
    if !merged.contains(&branch) && unpushed_commits(&c.repo, &branch) != Some(0) {
        return Ok(true);
    }
    let _ = Command::new("git").args(["branch", "-D", &branch]).current_dir(&c.repo).output();
    Ok(false)
}

/// Commits on `branch` that no remote-tracking ref has — work that exists only
/// here. `None` when git can't say (treated as "keep").
fn unpushed_commits(repo: &str, branch: &str) -> Option<u64> {
    git_out(repo, &["rev-list", "--count", branch, "--not", "--remotes"])?
        .trim()
        .parse()
        .ok()
}

fn record(app: &AppHandle, c: &Candidate, branch_kept: bool) {
    let now = crate::schedule::now_secs().max(0) as u64;
    let idle_days = now.saturating_sub(c.last_active) / 86_400;
    let mut title = format!("Workspace auto-deleted after {idle_days}d idle");
    if branch_kept {
        title.push_str(" (branch kept)");
    }
    let input = ActivityInput {
        workspace_id: Some(c.workspace_id.clone()),
        data: json!({ "path": c.path, "branchKept": branch_kept }),
        ..ActivityInput::new(ActivityKind::WorkspaceRemoved, Actor::System, &title)
    };
    crate::activity::record(app, input);
}

fn item(c: Candidate, held: Option<String>) -> CleanupItem {
    CleanupItem {
        workspace_id: c.workspace_id,
        kind: c.kind,
        label: c.label,
        path: c.path,
        last_active: c.last_active,
        held,
    }
}

#[cfg(test)]
mod tests {
    use super::super::settings::CleanupScope;
    use super::*;

    const DAY: u64 = 86_400;

    fn rules(scope: CleanupScope, only_archived: bool, only_done: bool) -> CleanupSettings {
        CleanupSettings {
            enabled: true,
            after_hours: 7 * 24,
            scope,
            sessions_only_archived: only_archived,
            tickets_only_done: only_done,
        }
    }

    #[test]
    fn nothing_qualifies_before_the_idle_period() {
        let s = rules(CleanupScope::Both, false, false);
        assert!(!qualifies(&s, WorkspaceKind::Session, true, 6 * DAY, || Some(true)));
        assert!(qualifies(&s, WorkspaceKind::Session, true, 7 * DAY, || Some(true)));
    }

    #[test]
    fn scope_selects_the_kind() {
        let s = rules(CleanupScope::Sessions, false, false);
        assert!(qualifies(&s, WorkspaceKind::Session, false, 8 * DAY, || None));
        assert!(!qualifies(&s, WorkspaceKind::Ticket, false, 8 * DAY, || Some(true)));
        let t = rules(CleanupScope::Tickets, false, false);
        assert!(!qualifies(&t, WorkspaceKind::Session, true, 8 * DAY, || None));
        assert!(qualifies(&t, WorkspaceKind::Ticket, false, 8 * DAY, || None));
    }

    #[test]
    fn only_archived_sessions_when_asked() {
        let s = rules(CleanupScope::Both, true, false);
        assert!(!qualifies(&s, WorkspaceKind::Session, false, 30 * DAY, || None));
        assert!(qualifies(&s, WorkspaceKind::Session, true, 30 * DAY, || None));
    }

    #[test]
    fn only_done_tickets_and_unknown_is_not_done() {
        let s = rules(CleanupScope::Both, false, true);
        assert!(qualifies(&s, WorkspaceKind::Ticket, false, 30 * DAY, || Some(true)));
        assert!(!qualifies(&s, WorkspaceKind::Ticket, false, 30 * DAY, || Some(false)));
        assert!(!qualifies(&s, WorkspaceKind::Ticket, false, 30 * DAY, || None));
    }

    #[test]
    fn the_tracker_is_not_asked_about_fresh_workspaces() {
        let s = rules(CleanupScope::Both, false, true);
        let asked = std::cell::Cell::new(false);
        qualifies(&s, WorkspaceKind::Ticket, false, DAY, || {
            asked.set(true);
            Some(true)
        });
        assert!(!asked.get());
    }
}
