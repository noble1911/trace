//! Exploratory ("scratch") sessions — interactive agents not tied to a tracker
//! issue. A session picks a configured repo and runs in its own worktree (like
//! issues, and linkable to a ticket later), or needs no repo at all and runs in a
//! plain folder. Legacy sessions predating these fields stay in the repo root.
//! Metadata persists locally so they survive restarts. The PTY transport, the
//! stop/input/resize commands, and Claude session-id resume are all shared with
//! board agents (`commands::agent`), keyed by the session id.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::agent_session::transport::Transport;
use crate::claude::conversations::forget_session_id;
use crate::commands::agent::spawn_in;
use crate::commands::session_agents::{discard_agents, stop_agents, SessionAgent};
use crate::commands::session_folder;
use crate::commands::session_origin::{self, CreatedBy};
use crate::commands::session_peer;
use crate::helpers::new_id;
use crate::helpers::persist::{self, Style};
use crate::state::{AppState, StartGuard};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScratchSession {
    pub id: String,
    pub title: String,
    /// "claude" | "codex".
    pub cli: String,
    /// Model provider for the Claude harness (`commands::providers` id —
    /// "moonshot" / "wafer" / "wafer-fast" / "deepseek" / "deepseek-pro").
    /// `None` = Anthropic.
    #[serde(default)]
    pub provider: Option<String>,
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
    /// The plain folder this session runs in when it has no repo: one the user
    /// picked, or a scratch folder trace made for it (see `scratch_root`). Git is
    /// never involved, so `worktree` is false. `None` on repo-backed sessions.
    #[serde(default)]
    pub folder: Option<String>,
    /// Extra agents sharing this session's worktree (`commands::session_agents`) —
    /// e.g. a codex agent continuing work claude started. Each has its own PTY and
    /// conversation; the worktree belongs to the session.
    #[serde(default)]
    pub agents: Vec<SessionAgent>,
    /// Started with Claude Code's Remote Control, so it can also be driven from
    /// claude.ai/code and the Claude app. Kept on every start (and resume), not
    /// just the first — Claude only enables it for the run it's passed to.
    #[serde(default)]
    pub remote_control: bool,
    /// Who started it (`session_origin`); `None` = the user, as for every
    /// session saved before this was recorded.
    #[serde(
        default,
        deserialize_with = "session_origin::lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub created_by: Option<CreatedBy>,
    /// Where its agent runs; `None` = this machine (`commands::session_host`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<crate::execution::SessionHost>,
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
    crate::helpers::trace_dir().join("scratch.json")
}

pub(crate) fn read() -> Result<Vec<ScratchSession>, String> {
    persist::read_or_default(&sessions_file())
}

/// The sessions for read-only callers: a read failure is logged and reads as none.
pub(crate) fn load() -> Vec<ScratchSession> {
    persist::read_or_log(&sessions_file())
}

/// Load, mutate and save the list, safe against other threads and another trace.
/// Quick work only: do git and PTY teardown outside it.
pub(crate) fn update<R>(f: impl FnOnce(&mut Vec<ScratchSession>) -> R) -> Result<R, String> {
    persist::update(&sessions_file(), Style::Compact, f)
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// All saved sessions (active + archived), newest first. Archived sessions past
/// the retention window are purged here (and their Claude ids forgotten).
#[tauri::command]
pub fn list_sessions() -> Result<Vec<ScratchSession>, String> {
    let now = now_secs();
    let expired = |s: &ScratchSession| {
        s.archived_at
            .is_some_and(|at| now.saturating_sub(at) >= ARCHIVE_RETENTION_SECS)
    };
    let mut list = read()?;
    // Git runs here, so it's outside the lock; only then do the records go.
    let mut purged = Vec::new();
    for s in list.iter().filter(|s| expired(s)) {
        let _ = forget_session_id(&s.id);
        for agent in &s.agents {
            let _ = forget_session_id(&agent.id);
        }
        crate::commands::worktrees::remove_for_workspace(&s.id);
        session_folder::remove_scratch_folder(s);
        purged.push(s.id.clone());
    }
    if !purged.is_empty() {
        let _ = update(|saved| saved.retain(|s| !(purged.contains(&s.id) && expired(s))));
        list.retain(|s| !expired(s));
    }
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(list)
}

/// Create (persist) a new exploratory session. Does not start its agent. With a
/// `repo` it gets a worktree of that repo. Without one it runs in `folder`, or in a
/// new scratch folder if that's absent too, so no session needs git. `created_by`
/// unset = the user.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn create_session(
    title: String,
    cli: String,
    provider: Option<String>,
    repo: Option<String>,
    folder: Option<String>,
    remote_control: Option<bool>,
    created_by: Option<CreatedBy>,
    // "vercel" runs it in a sandbox; unset = this machine.
    host: Option<String>,
) -> Result<ScratchSession, String> {
    let title = title.trim();
    let title = if title.is_empty() {
        "Exploration".to_string()
    } else {
        title.to_string()
    };
    let cli = if cli == "codex" { "codex" } else { "claude" }.to_string();
    // The provider only applies to the Claude harness — keep registered
    // Anthropic-compatible endpoints, drop unknown ids and anything on codex.
    let provider = if cli == "claude" {
        provider.filter(|p| crate::commands::providers::spec(p).is_some())
    } else {
        None
    };
    // Remote Control runs through the user's claude.ai account: Claude only,
    // and on Anthropic — a third-party endpoint can't serve it.
    let remote_control = remote_control.unwrap_or(false) && cli == "claude";
    let provider = if remote_control { None } else { provider };
    // A session on another computer has no folder or repo here (`session_peer`).
    if host.as_deref().and_then(session_peer::peer_id).is_some() {
        return session_peer::create(title, cli, repo.as_deref(), host.as_deref(), created_by);
    }
    let repo = repo.map(|r| r.trim().to_string()).filter(|r| !r.is_empty());
    if repo
        .as_ref()
        .is_some_and(|r| !crate::commands::repos::all_repos().contains(r))
    {
        return Err("That repository isn't configured in Settings.".to_string());
    }
    let id = new_id();
    let host = crate::commands::session_host::new_host(host.as_deref(), &id, repo.as_deref())?;
    let folder = if repo.is_some() {
        None
    } else {
        Some(session_folder::resolve_folder(folder, &title, &id)?)
    };
    let session = ScratchSession {
        id,
        title,
        cli,
        provider,
        created_at: now_secs(),
        archived_at: None,
        tab: None,
        section: None,
        // A sandbox session's checkout is in the sandbox, not here.
        worktree: repo.is_some() && host.is_none(),
        repo,
        folder,
        agents: Vec::new(),
        remote_control,
        created_by: created_by.and_then(CreatedBy::sanitize),
        host,
    };
    update(|list| list.push(session.clone()))?;
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
    update(|list| {
        let s = list.iter_mut().find(|s| s.id == id)?;
        s.title = title;
        Some(s.clone())
    })?
    .ok_or_else(|| "That session no longer exists.".to_string())
}

/// The session that owns a workspace id: the session itself, or — for a
/// companion agent (`commands::session_agents`) — the session whose worktree it
/// shares. This is what lets a companion id flow through the shell terminal, the
/// editor action, and cwd resolution without any of them knowing it isn't a
/// session id.
pub(crate) fn owning_session(id: &str) -> Option<ScratchSession> {
    load()
        .into_iter()
        .find(|s| s.id == id || s.agents.iter().any(|a| a.id == id))
}

/// Whether a workspace id belongs to an exploratory session (vs a Jira issue) —
/// true for a session's own id and for any of its companion agents.
pub(crate) fn is_session(id: &str) -> bool {
    owning_session(id).is_some()
}

pub(crate) use crate::commands::session_cwd::{cwd_of, session_cwd};

/// Move a session to the recycle bin: stop its PTYs (its own agent, its shell and
/// any companions) but keep the metadata and Claude ids so it can be restored and
/// resumed.
#[tauri::command]
pub fn archive_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(session) = owning_session(&id) {
        stop_agents(&state, &session.workspace_ids());
    }
    let now = now_secs();
    update(|list| {
        for s in list.iter_mut().filter(|s| s.id == id) {
            s.archived_at = Some(now);
        }
    })
}

/// Restore a session from the recycle bin.
#[tauri::command]
pub fn unarchive_session(id: String) -> Result<(), String> {
    update(|list| {
        for s in list.iter_mut().filter(|s| s.id == id) {
            s.archived_at = None;
        }
    })
}

/// Delete a session: stop its PTY if live, drop its saved Claude id, remove it.
#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // Everything the session owned goes: its agent, its shell, its companions.
    if let Some(session) = owning_session(&id) {
        discard_agents(&state, &session.workspace_ids());
        for agent in &session.agents {
            let _ = forget_session_id(&agent.id);
            crate::agent_session::runtime::forget(&agent.id);
        }
        session_folder::remove_scratch_folder(&session);
        crate::commands::session_host::forget_remote(&session);
    }
    let _ = forget_session_id(&id);
    crate::agent_session::runtime::forget(&id);
    // Clean up any worktree/branch backing this workspace — the session is
    // gone for good, so its checkout is too.
    crate::commands::worktrees::remove_for_workspace(&id);
    update(|list| list.retain(|s| s.id != id))
}

/// Start (or resume) an exploratory session's agent in its worktree.
/// `initial_prompt` is submitted as its first message, fresh conversation or
/// resumed — what an agent driving the session over trace's tools asks of it.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn start_session(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    cols: u16,
    rows: u16,
    extra_args: Option<Vec<String>>,
    initial_prompt: Option<String>,
    // "chat" | "terminal"; unset keeps what the session ran on last.
    transport: Option<String>,
) -> Result<(), String> {
    if state.pty_sessions.lock().contains_key(&id) {
        return Ok(());
    }
    let Some(_guard) = StartGuard::acquire(&state, &id) else {
        return Ok(());
    };

    let session = load()
        .into_iter()
        .find(|s| s.id == id)
        .ok_or("That session no longer exists.")?;

    // Worktree sessions get the same isolation as issues (and become linkable to
    // a ticket later), created on demand; legacy sessions stay in the repo root
    // where their Claude conversations live. Shared with the shell terminal.
    let cwd = match &session.host {
        Some(host) => crate::commands::session_host::sandbox_cwd(host),
        None => session_cwd(&id, true)?,
    };
    let mut extra_args = extra_args.unwrap_or_default();
    if session.remote_control {
        // Named after the session, so it's recognisable in claude.ai/code.
        extra_args.push("--remote-control".to_string());
        extra_args.push(session.title.clone());
    }

    spawn_in(
        app,
        &state,
        id,
        cwd,
        session.cli,
        None,
        extra_args,
        initial_prompt.clone(),
        initial_prompt,
        session.provider,
        // Remote Control is the TUI's: a session started with it is a terminal.
        if session.remote_control {
            Some(Transport::Terminal)
        } else {
            transport.as_deref().and_then(Transport::parse)
        },
        cols,
        rows,
    )
}
