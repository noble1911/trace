//! Exploratory ("scratch") sessions — interactive agents not tied to a Jira
//! issue. They run in the configured repo root (no worktree) and persist their
//! metadata locally so they survive restarts. The PTY transport, the stop/input/
//! resize commands, and Claude session-id resume are all shared with board
//! agents (`commands::agent`), keyed by the session id.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::agent::{forget_session_id, spawn_in};
use crate::git;
use crate::helpers::new_id;
use crate::state::{AppState, StartGuard};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScratchSession {
    pub id: String,
    pub title: String,
    /// "claude" | "codex".
    pub cli: String,
    /// Unix epoch seconds at creation (display ordering on the frontend).
    pub created_at: u64,
    /// Epoch seconds when archived (in the recycle bin); `None` = active. Purged
    /// automatically after the retention window.
    #[serde(default)]
    pub archived_at: Option<u64>,
    /// Owning tab id (`commands::groups`); `None` = the default tab.
    #[serde(default)]
    pub tab: Option<String>,
    /// Section id within the tab; `None` = the tab's unsectioned area.
    #[serde(default)]
    pub section: Option<String>,
    /// Whether this session runs in its own worktree. New sessions do (which
    /// also makes them linkable to a ticket); sessions from before this field
    /// keep the repo root — their Claude conversations are keyed to that cwd.
    #[serde(default)]
    pub worktree: bool,
}

/// How long an archived session lingers before it's auto-purged (14 days).
const ARCHIVE_RETENTION_SECS: u64 = 14 * 24 * 60 * 60;

fn sessions_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("scratch.json")
}

fn load() -> Vec<ScratchSession> {
    std::fs::read_to_string(sessions_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(list: &[ScratchSession]) -> Result<(), String> {
    let path = sessions_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(list).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    crate::helpers::restrict_perms(&path);
    Ok(())
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// All saved sessions (active + archived), newest first. Archived sessions past
/// the retention window are purged here (and their Claude ids forgotten).
#[tauri::command]
pub fn list_sessions() -> Vec<ScratchSession> {
    let now = now_secs();
    let mut list = load();
    let before = list.len();
    list.retain(|s| match s.archived_at {
        Some(at) => {
            let keep = now.saturating_sub(at) < ARCHIVE_RETENTION_SECS;
            if !keep {
                let _ = forget_session_id(&s.id);
                crate::commands::worktrees::remove_for_workspace(&s.id);
            }
            keep
        }
        None => true,
    });
    if list.len() != before {
        let _ = save(&list);
    }
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    list
}

/// Create (persist) a new exploratory session. Does not start its agent.
#[tauri::command]
pub fn create_session(title: String, cli: String) -> Result<ScratchSession, String> {
    let title = title.trim();
    let title = if title.is_empty() { "Exploration".to_string() } else { title.to_string() };
    let cli = if cli == "codex" { "codex" } else { "claude" }.to_string();
    let session = ScratchSession {
        id: new_id(),
        title,
        cli,
        created_at: now_secs(),
        archived_at: None,
        tab: None,
        section: None,
        worktree: true,
    };
    let mut list = load();
    list.push(session.clone());
    save(&list)?;
    Ok(session)
}

/// Rename a session. Empty titles are rejected rather than silently kept so
/// the UI can surface the validation.
#[tauri::command]
pub fn rename_session(id: String, title: String) -> Result<ScratchSession, String> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err("Give the session a name.".to_string());
    }
    let mut list = load();
    let mut renamed = None;
    for s in &mut list {
        if s.id == id {
            s.title = title.clone();
            renamed = Some(s.clone());
        }
    }
    let renamed = renamed.ok_or("That session no longer exists.")?;
    save(&list)?;
    Ok(renamed)
}

/// Whether a workspace id belongs to an exploratory session (vs a Jira issue).
pub(crate) fn is_session(id: &str) -> bool {
    load().iter().any(|s| s.id == id)
}

/// Bind an exploratory session's workspace to a Jira issue. Nothing moves on
/// disk — the issue *adopts* the session's worktree (a Claude conversation is
/// keyed by its absolute cwd, so relocating it would orphan the history), the
/// conversation id transfers to the issue key, the branch is renamed to the
/// issue convention so PRs work, and the session is consumed.
#[tauri::command]
pub fn link_session_to_issue(
    state: State<'_, AppState>,
    id: String,
    issue_key: String,
) -> Result<(), String> {
    let mut list = load();
    let Some(pos) = list.iter().position(|s| s.id == id) else {
        return Err("That session no longer exists.".to_string());
    };
    if !list[pos].worktree {
        return Err(
            "This session predates worktree sessions and shares the repo root — it can't be \
             bound to a ticket."
                .to_string(),
        );
    }
    let repo = crate::commands::repos::default_repo()
        .ok_or("Add a repository in Settings first.")?;
    let dirname = crate::commands::repos::workspace_dirname(&id);
    let dir = format!("{repo}/.worktrees/{dirname}");
    if !std::path::Path::new(&dir).exists() {
        return Err("Start this session once before linking — it has no worktree yet.".to_string());
    }
    // Refuse if the issue already has its own checkout — merging two working
    // trees isn't something we can do safely.
    let issue_dir = crate::commands::repos::workspace_dir(&repo, &issue_key);
    if issue_dir != dir && std::path::Path::new(&issue_dir).exists() {
        return Err(format!(
            "{issue_key} already has a worktree — remove it first (Settings → Worktrees)."
        ));
    }

    // Stop the session's PTYs; the conversation resumes under the issue key.
    for key in [id.clone(), format!("term:{id}")] {
        let live = state.pty_sessions.lock().remove(&key);
        if let Some(mut s) = live {
            s.kill();
        }
        state.child_pids.lock().remove(&key);
        state.output_history.lock().remove(&key);
    }

    // Rename the branch to the issue convention (renames don't touch the cwd).
    let old_branch = format!("workspace/{}", crate::helpers::slugify(&id));
    let new_branch = format!("workspace/{}", crate::helpers::slugify(&issue_key));
    let out = std::process::Command::new("git")
        .args(["branch", "-m", &old_branch, &new_branch])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("git branch rename failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Couldn't rename the session branch: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }

    crate::commands::repos::adopt_workspace_dir(&issue_key, &dirname, &repo)?;
    crate::commands::agent::move_session_id(&id, &issue_key)?;

    list.remove(pos);
    save(&list)
}

/// File a session under a tab and/or section (`None` = default/unsectioned).
#[tauri::command]
pub fn set_session_group(
    id: String,
    tab: Option<String>,
    section: Option<String>,
) -> Result<ScratchSession, String> {
    let mut list = load();
    let Some(s) = list.iter_mut().find(|s| s.id == id) else {
        return Err("That session no longer exists.".to_string());
    };
    s.tab = tab;
    s.section = section;
    let updated = s.clone();
    save(&list)?;
    Ok(updated)
}

/// Clear session refs to tabs/sections that no longer exist (after a
/// groups save deleted them). Sessions fall back to default/unsectioned.
pub(crate) fn reconcile_groups(
    groups: &crate::commands::groups::SessionGroups,
) -> Result<(), String> {
    let mut list = load();
    let mut changed = false;
    for s in &mut list {
        if let Some(tab) = &s.tab {
            if !groups.tabs.iter().any(|t| &t.id == tab) {
                s.tab = None;
                s.section = None;
                changed = true;
            }
        }
        if let Some(section) = &s.section {
            let valid = groups
                .sections
                .iter()
                .any(|sec| &sec.id == section && sec.tab == s.tab);
            if !valid {
                s.section = None;
                changed = true;
            }
        }
    }
    if changed {
        save(&list)?;
    }
    Ok(())
}

/// Move a session to the recycle bin: stop its PTY but keep its metadata and
/// Claude id so it can be restored and resumed.
#[tauri::command]
pub fn archive_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let live = state.pty_sessions.lock().remove(&id);
    if let Some(mut session) = live {
        session.kill();
    }
    state.child_pids.lock().remove(&id);
    let mut list = load();
    let now = now_secs();
    for s in &mut list {
        if s.id == id {
            s.archived_at = Some(now);
        }
    }
    save(&list)
}

/// Restore a session from the recycle bin.
#[tauri::command]
pub fn unarchive_session(id: String) -> Result<(), String> {
    let mut list = load();
    for s in &mut list {
        if s.id == id {
            s.archived_at = None;
        }
    }
    save(&list)
}

/// Delete a session: stop its PTY if live, drop its saved Claude id, remove it.
#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Take the session out of the map (dropping the guard) before killing it, so
    // we never hold the lock across the wait.
    let live = state.pty_sessions.lock().remove(&id);
    if let Some(mut session) = live {
        session.kill();
    }
    state.child_pids.lock().remove(&id);
    state.output_history.lock().remove(&id);
    let _ = forget_session_id(&id);
    // Clean up any worktree/branch backing this workspace — the session is
    // gone for good, so its checkout is too.
    crate::commands::worktrees::remove_for_workspace(&id);
    let mut list = load();
    list.retain(|s| s.id != id);
    save(&list)
}

/// Start an exploratory session's agent in the configured repo root (no worktree).
#[tauri::command]
pub fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    extra_args: Option<Vec<String>>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&id) {
        return Ok(());
    }
    let Some(_guard) = StartGuard::acquire(&state, &id) else {
        return Ok(());
    };

    let session =
        load().into_iter().find(|s| s.id == id).ok_or("That session no longer exists.")?;

    let repo = crate::commands::repos::default_repo()
        .ok_or("Add a repository in Settings before starting a session.")?;

    let busy = git::git_busy_check(&repo);
    if busy.starts_with("busy") {
        return Err(format!("Repository is {busy} — finish that git operation first."));
    }

    // Worktree sessions get the same isolation as issues (and become linkable
    // to a ticket later); legacy sessions stay in the repo root where their
    // Claude conversations live.
    let cwd = if session.worktree {
        let worktree = crate::commands::repos::workspace_dir(&repo, &id);
        let branch = format!("workspace/{}", crate::helpers::slugify(&id));
        let default_branch = git::get_default_branch(&repo);
        git::create_worktree(&repo, &worktree, &branch, &default_branch)?;
        worktree
    } else {
        repo
    };

    spawn_in(app, &state, id, cwd, session.cli, None, extra_args.unwrap_or_default(), None, cols, rows)
}
