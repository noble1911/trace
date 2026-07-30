//! Exploratory ("scratch") sessions — interactive agents not tied to a Jira
//! issue. New sessions run in their own worktree (like issues, and linkable to a
//! ticket later); legacy sessions predating that field stay in the repo root.
//! Metadata persists locally so they survive restarts. The PTY transport, the
//! stop/input/resize commands, and Claude session-id resume are all shared with
//! board agents (`commands::agent`), keyed by the session id.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::agent::{forget_session_id, spawn_in};
use crate::commands::session_agents::{discard_agents, stop_agents, SessionAgent};
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
    /// The configured repo this session runs in, chosen at creation. `None` for
    /// sessions created before this field (and a fallback to the first
    /// configured repo at start time).
    #[serde(default)]
    pub repo: Option<String>,
    /// Extra agents sharing this session's worktree (`commands::session_agents`) —
    /// e.g. a codex agent continuing work claude started. Each has its own PTY and
    /// conversation; the worktree belongs to the session.
    #[serde(default)]
    pub agents: Vec<SessionAgent>,
}

impl ScratchSession {
    /// Workspace ids this session is responsible for: its own agent, its shell,
    /// and every companion. What has to be torn down when the session goes away.
    pub(crate) fn workspace_ids(&self) -> Vec<String> {
        let mut ids = vec![self.id.clone(), format!("term:{}", self.id)];
        ids.extend(self.agents.iter().map(|a| a.id.clone()));
        ids
    }
}

/// How long an archived session lingers before it's auto-purged (14 days).
const ARCHIVE_RETENTION_SECS: u64 = 14 * 24 * 60 * 60;

fn sessions_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("scratch.json")
}

pub(crate) fn load() -> Vec<ScratchSession> {
    std::fs::read_to_string(sessions_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub(crate) fn save(list: &[ScratchSession]) -> Result<(), String> {
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
                for agent in &s.agents {
                    let _ = forget_session_id(&agent.id);
                }
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
pub fn create_session(
    title: String,
    cli: String,
    repo: Option<String>,
) -> Result<ScratchSession, String> {
    let title = title.trim();
    let title = if title.is_empty() { "Exploration".to_string() } else { title.to_string() };
    let cli = if cli == "codex" { "codex" } else { "claude" }.to_string();
    // Only honor a repo that's actually configured; anything else falls back to
    // the default repo at start time (`None`).
    let repo = repo.and_then(|r| {
        let r = r.trim().to_string();
        (!r.is_empty() && crate::commands::repos::all_repos().contains(&r)).then_some(r)
    });
    let session = ScratchSession {
        id: new_id(),
        title,
        cli,
        created_at: now_secs(),
        archived_at: None,
        tab: None,
        section: None,
        worktree: true,
        repo,
        agents: Vec::new(),
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

/// The session that owns a workspace id: the session itself, or — for a
/// companion agent (`commands::session_agents`) — the session whose worktree it
/// shares. This is what lets a companion id flow through the shell terminal, the
/// editor action, and cwd resolution without any of them knowing it isn't a
/// session id.
pub(crate) fn owning_session(id: &str) -> Option<ScratchSession> {
    load().into_iter().find(|s| s.id == id || s.agents.iter().any(|a| a.id == id))
}

/// Whether a workspace id belongs to an exploratory session (vs a Jira issue) —
/// true for a session's own id and for any of its companion agents.
pub(crate) fn is_session(id: &str) -> bool {
    owning_session(id).is_some()
}

/// Resolve the working directory for a scratch session, honoring the session's
/// own `repo` (not the global default) so sessions created against a non-default
/// repo land in the right place.
///
/// A worktree-backed session runs in `<repo>/.worktrees/<slug>`. `create`
/// controls what happens when that worktree isn't on disk yet:
/// - `true` (agent start, shell terminal): create it on demand — mirrors
///   `start_session`, so the shell always opens in the session's worktree
///   rather than falling back to the repo root.
/// - `false` ("open in editor"): fall back to the repo root — opening an editor
///   shouldn't materialize a git worktree as a side effect.
///
/// Legacy sessions without a worktree always resolve to the repo root, where
/// their Claude conversation is keyed.
///
/// `id` may be a companion agent's id: the worktree belongs to the *session*, so
/// every agent on it resolves to the same directory — that shared cwd is the
/// whole point of companions.
pub(crate) fn session_cwd(id: &str, create: bool) -> Result<String, String> {
    let session = owning_session(id).ok_or("That session no longer exists.")?;
    let repo = session
        .repo
        .clone()
        .or_else(crate::commands::repos::default_repo)
        .ok_or("Add a repository in Settings first.")?;
    if !session.worktree {
        return Ok(repo);
    }
    let worktree = crate::commands::repos::workspace_dir(&repo, &session.id);
    if std::path::Path::new(&worktree).exists() {
        return Ok(worktree);
    }
    if !create {
        return Ok(repo);
    }
    let busy = git::git_busy_check(&repo);
    if busy.starts_with("busy") {
        return Err(format!("Repository is {busy} — finish that git operation first."));
    }
    let branch = format!("workspace/{}", crate::helpers::slugify(&session.id));
    let default_branch = git::get_default_branch(&repo);
    git::create_worktree(&repo, &worktree, &branch, &default_branch)?;
    Ok(worktree)
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

/// Move a session to the recycle bin: stop its PTYs (its own agent, its shell and
/// any companions) but keep the metadata and Claude ids so it can be restored and
/// resumed.
#[tauri::command]
pub fn archive_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(session) = owning_session(&id) {
        stop_agents(&state, &session.workspace_ids());
    }
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
    // Everything the session owned goes: its agent, its shell, its companions.
    if let Some(session) = owning_session(&id) {
        discard_agents(&state, &session.workspace_ids());
        for agent in &session.agents {
            let _ = forget_session_id(&agent.id);
        }
    }
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

    // Worktree sessions get the same isolation as issues (and become linkable to
    // a ticket later), created on demand; legacy sessions stay in the repo root
    // where their Claude conversations live. Shared with the shell terminal.
    let cwd = session_cwd(&id, true)?;

    spawn_in(app, &state, id, cwd, session.cli, None, extra_args.unwrap_or_default(), None, cols, rows)
}
