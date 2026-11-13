//! Where an agent runs: this machine today, and later another trace over
//! Tailscale or a cloud sandbox (`docs/REMOTE_EXECUTION_PLAN.md`).
//!
//! Two ports. [`AgentSession`] is one running agent's terminal, which is all the
//! rest of the app touches once an agent is up: `AppState.pty_sessions` holds
//! them as [`LiveSession`]s, whatever is behind them. [`AgentHost`] is somewhere
//! agents start. Hosts are picked at runtime and several can be connected at
//! once, so this follows `issues::IssueProvider` (a [`Host`] enum over trait
//! impls), not `platform::ports`, which picks one adapter per build.
//!
//! `list` and `attach` (finding and joining sessions another trace started) join
//! [`AgentHost`] with the first remote host: on this machine there is nothing to
//! find that `AppState` doesn't already hold.

pub mod credential;
pub mod local;
pub mod peer;
pub mod sandbox;
pub mod vercel;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// One running agent's terminal, wherever its process is. What the PTY commands
/// (`send_agent_input`, `resize_agent`, `stop_agent`) and exit handling need.
pub trait AgentSession: Send {
    /// Forward keystrokes or pasted text.
    fn write_input(&mut self, data: &[u8]) -> std::io::Result<()>;

    /// Re-lay-out the TUI to the visible xterm size.
    fn resize(&self, cols: u16, rows: u16) -> Result<(), String>;

    /// The process id on this machine, for signals. None for one elsewhere.
    fn pid(&self) -> Option<u32>;

    /// Tells this run from a later one under the same workspace id, so an old
    /// run ending can't tear down a new one (`claude::pty_exit::take_session`).
    /// The process id here; a remote session has its own.
    fn run_id(&self) -> Option<u64> {
        self.pid().map(u64::from)
    }

    /// End the agent, for everyone watching it.
    fn stop(&mut self);

    /// Whether dropping this session leaves its agent running (it's on another
    /// host), so trace can disconnect without stopping it (`detach_agent`).
    fn can_detach(&self) -> bool {
        false
    }
}

/// A running agent as `AppState` holds it.
pub type LiveSession = Box<dyn AgentSession>;

/// Everything an agent start needs once trace's own wiring is worked out
/// (`claude::launch`): the host only has to run it.
#[derive(Debug, Clone)]
pub struct SpawnSpec {
    pub workspace_id: String,
    pub cwd: String,
    /// "claude" or "codex".
    pub cli: String,
    /// A saved conversation to `--resume`.
    pub resume_id: Option<String>,
    /// The `--session-id` pinned for a new conversation.
    pub new_session_id: Option<String>,
    pub model: Option<String>,
    pub extra_args: Vec<String>,
    /// Submitted as the CLI's positional argument.
    pub prompt: Option<String>,
    /// For another host, which alone can tell a continued conversation from a
    /// fresh one: sent instead of `prompt` when it continues one. On this
    /// machine `prompt` is already the right one, and this is None.
    pub resume_prompt: Option<String>,
    /// Never logged: it can hold provider keys.
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

/// What a host can fill besides the agent's screen. The workspace tabs that
/// need something a host can't give are greyed out rather than broken. It
/// crosses the peer protocol, so a field one side doesn't know reads as `false`.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct Capabilities {
    /// Claude Code's Stop/Notification hooks reach trace, so turns are exact
    /// rather than guessed from a quiet screen.
    pub turn_hooks: bool,
    /// The conversation JSONL can be read, for the Transcript view.
    pub transcript: bool,
    /// The worktree can be read: Files and diffs.
    pub files: bool,
    /// A plain shell beside the agent: the Terminal tab.
    pub terminal: bool,
    /// The Tests tab can run the project's tests.
    pub tests: bool,
    /// trace's own MCP tools reach the agent.
    pub agent_tools: bool,
    /// It can run as a chat (headless, structured) as well as in a terminal.
    pub chat: bool,
}

impl Capabilities {
    /// Everything: the agent runs beside trace.
    pub const ALL: Capabilities = Capabilities {
        turn_hooks: true,
        transcript: true,
        files: true,
        terminal: true,
        tests: true,
        agent_tools: true,
        chat: true,
    };
}

/// Why a host couldn't do something.
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("{0}")]
    Spawn(String),
}

/// Somewhere agents start.
pub trait AgentHost {
    /// What this host's agents can do besides their screen.
    fn capabilities(&self) -> Capabilities;

    /// Start an agent. Its output streams as `pty-output` from here on, and its
    /// end is reported as `agent-run-state`, whichever host runs it.
    fn spawn(&self, app: &AppHandle, spec: SpawnSpec) -> Result<LiveSession, HostError>;

    /// How to start a chat agent here, when it isn't this machine (where the
    /// chat runtime spawns its own child). None: no chat, or local.
    fn chat_opener(&self) -> Option<crate::agent_session::process::RemoteOpener> {
        None
    }
}

/// Where a session's agent runs, as the session record keeps it. Absent means
/// this machine.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionHost {
    /// A Vercel sandbox, named `trace-<session id>`.
    Vercel {
        sandbox: String,
        /// The repo it checks out, `owner/name` on GitHub.
        #[serde(default)]
        remote: Option<String>,
    },
    /// Another trace over Tailscale (`peer`).
    #[serde(rename_all = "camelCase")]
    Peer {
        /// The paired peer's id (`peers.json`).
        peer: String,
        /// The repo on that peer, by the name in its capabilities.
        repo: String,
        /// The peer's own id for the session, once it has started it: what
        /// Start rejoins.
        #[serde(default)]
        remote_id: Option<String>,
    },
}

impl SessionHost {
    /// What a session on this host can do besides its screen, from the record
    /// alone (no provider call), so the UI can ask cheaply. Matches what the
    /// host's own [`AgentHost::capabilities`] reports.
    pub fn capabilities(&self) -> Capabilities {
        match self {
            // The screen, the chat, hooks (its event log) and Files (read remotely).
            SessionHost::Vercel { .. } => sandbox::host::CAPABILITIES,
            SessionHost::Peer { .. } => peer::capabilities::SERVED_FEATURES,
        }
    }
}

/// The hosts trace can run agents on.
pub enum Host {
    Local(local::LocalHost),
    Vercel(Box<sandbox::host::SandboxHost<vercel::Vercel>>),
    Peer(Box<peer::client::host::PeerHost>),
}

impl Host {
    /// This machine.
    pub fn local() -> Host {
        Host::Local(local::LocalHost)
    }

    /// The host behind the enum, for calling the port.
    pub fn port(&self) -> &dyn AgentHost {
        match self {
            Host::Local(host) => host,
            Host::Vercel(host) => host.as_ref(),
            Host::Peer(host) => host.as_ref(),
        }
    }

    /// Whether the agent runs beside trace, with everything that implies
    /// (hooks, tools, transcripts, its folder on this disk).
    pub fn is_local(&self) -> bool {
        matches!(self, Host::Local(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn this_machine_can_do_everything() {
        let host = Host::local();
        assert!(host.is_local());
        assert_eq!(host.port().capabilities(), Capabilities::ALL);
    }

    #[test]
    fn a_sandbox_session_offers_its_screen_chat_hooks_and_files() {
        let host = SessionHost::Vercel {
            sandbox: "trace-abc".into(),
            remote: None,
        };
        let caps = host.capabilities();
        assert!(caps.chat && caps.turn_hooks && caps.files && caps.agent_tools);
        assert!(!caps.transcript && !caps.terminal && !caps.tests);
    }

    #[test]
    fn a_session_host_matches_the_renderer_shape() {
        let host = SessionHost::Vercel {
            sandbox: "trace-abc".into(),
            remote: Some("noble1911/trace".into()),
        };
        let json = serde_json::to_value(&host).unwrap_or_default();
        assert_eq!(json["kind"], "vercel");
        assert_eq!(json["sandbox"], "trace-abc");
        assert_eq!(json["remote"], "noble1911/trace");
    }

    #[test]
    fn capabilities_reach_the_renderer_in_camel_case() {
        let json = serde_json::to_value(Capabilities::ALL).unwrap_or_default();
        assert_eq!(json["turnHooks"], true);
        assert_eq!(json["agentTools"], true);
    }

    #[test]
    fn capabilities_a_peer_leaves_out_read_as_missing() {
        let caps: Capabilities =
            serde_json::from_str(r#"{"turnHooks":true,"somethingNew":true}"#).unwrap_or_default();
        assert!(caps.turn_hooks);
        assert!(!caps.files);
    }
}
