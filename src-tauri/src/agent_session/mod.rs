//! Agents run headless over a structured protocol, shown as a chat. See
//! docs/AGENT_CHAT.md.
//!
//! - `journal`: the rows every brand's conversation becomes, and what the UI renders.
//! - An adapter per brand implements `AgentAdapter` and turns its protocol into rows.
//!
//! This is the contract the runtime and the UI are built against; the runtime
//! (process handling, persistence, commands) and the adapters live beside it.
//!
//! - `registry`: the chat agents, starting, running or stopping.
//! - `runtime`: starting and driving them; `sink`: what persists and emits their rows.
//! - `store`: the journal file; `settle`: rows a vanished process left open.
//! - `backfill`: the conversation's turns from outside a chat run, added to it.
//! - `transport`: whether each workspace runs as a chat or in the terminal.
//! - `claude`, `codex`: the adapters; `brands` picks one by its CLI.
//! - `attachments`: files sent with a message (pasted ones saved to disk first).
//! - `options`: each workspace's model, effort and permission mode.

pub mod attachments;
pub mod backfill;
pub mod brands;
pub mod claude;
pub mod codex;
pub mod journal;
pub mod options;
pub mod process;
pub mod registry;
pub mod runtime;
pub mod settle;
mod sink;
pub mod store;
pub mod subagent;
pub mod transport;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use journal::{Answer, JournalRow};
use options::AgentOptions;

/// What a chat agent is started with. Brand-neutral; an adapter maps it to flags.
#[derive(Clone, Debug)]
pub struct LaunchSpec {
    pub workspace_id: String,
    pub cwd: PathBuf,
    pub model: Option<String>,
    /// The agent's own conversation id to resume, if it has one saved.
    pub resume: Option<String>,
    /// Flags from Settings → Agents, appended as for a terminal agent.
    pub extra_args: Vec<String>,
    /// Extra environment (trace's render bridge, a provider's endpoint, …).
    pub env: Vec<(String, String)>,
    /// The `seq` the adapter's first new row takes, continuing the journal: only
    /// the runtime has read it, and rows must keep their order across restarts.
    pub next_seq: u64,
    /// The workspace's picked effort and permission mode (its model is
    /// `model`, already resolved against the provider).
    pub options: AgentOptions,
    /// trace's own tools, served over the agent's control channel, for an
    /// agent the loopback endpoint can't reach (one in a sandbox). None: the
    /// agent gets them through `--mcp-config` as usual, or not at all.
    pub tools: Option<ToolsHost>,
}

/// Answers one MCP JSON-RPC message for trace's tools (`agent_tools::rpc`):
/// the reply, or None for a notification. May wait on the user (a confirm
/// card), so it's called off the agent's own thread.
#[derive(Clone)]
pub struct ToolsHost(pub std::sync::Arc<ToolsFn>);

type ToolsFn = dyn Fn(&serde_json::Value) -> Option<serde_json::Value> + Send + Sync;

impl std::fmt::Debug for ToolsHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToolsHost")
    }
}

/// A user turn.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessage {
    pub text: String,
    /// Absolute paths of attached files or images.
    #[serde(default)]
    pub attachments: Vec<String>,
}

/// Facts about the running agent that aren't conversation rows.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The agent's own conversation id, saved for resuming.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(default)]
    pub slash_commands: Vec<String>,
    /// Whether a turn is running.
    pub busy: bool,
    /// Subagents still working, including background ones that outlived their
    /// turn: the agent counts as working while there are any.
    #[serde(default)]
    pub running_subagents: u32,
    /// Usage-limit windows, as the agent reports them (e.g. "seven_day" → 0.31).
    #[serde(default)]
    pub limits: Vec<LimitWindow>,
    /// How full the main conversation's context window is, once a model call
    /// has reported it. Subagents' calls never move it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<ContextUsage>,
    /// The reasoning effort in effect, when known (Claude Code's names; Codex's
    /// own for Codex). None: the CLI's default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    /// The permission mode in effect (Claude Code's names), when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    /// The third-party provider behind the agent, which pins its model. None
    /// for Anthropic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    /// Work still running behind the conversation that isn't a subagent: a
    /// shell started in the background, a monitor, a workflow. It has no row of
    /// its own once its call returns, so this is the only place it shows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub background: Vec<BackgroundTask>,
}

/// What kind of background work a task is, as the chat's fact strip names it.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskKind {
    /// A shell command left running (`run_in_background`, or one that outlived its turn).
    Shell,
    /// Something watched for events (Claude's Monitor tool).
    Monitor,
    /// A multi-agent workflow.
    Workflow,
    /// An agent that isn't one of the conversation's subagents (remote, a teammate).
    Agent,
    Other,
}

impl TaskKind {
    /// Agents and workflows report back when they finish, so the agent is still
    /// at work while one runs; a shell or monitor can run for as long as it likes.
    pub fn is_work(self) -> bool {
        matches!(self, TaskKind::Workflow | TaskKind::Agent)
    }
}

/// One running background task (`SessionInfo::background`).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTask {
    /// The agent's own id for it.
    pub task_id: String,
    pub kind: TaskKind,
    /// What it is, in the agent's words: a shell's command or description.
    pub description: String,
    /// When it started (unix ms).
    pub started_at: u64,
    /// The call that started it, which also names it to stop (`stop_subagent`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub call_id: Option<String>,
}

impl SessionInfo {
    /// Still at work: a turn running, or subagents that outlived it. What a
    /// resume after a quit goes by (`interrupted`), as a terminal agent's turn
    /// that ends with background tasks pending stays busy (`claude::hooks`).
    pub fn at_work(&self) -> bool {
        self.busy || self.running_subagents > 0
    }
}

/// One usage-limit window, so the header can warn before the agent is cut off.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub name: String,
    /// 0.0–1.0.
    pub utilization: f64,
    /// Unix seconds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<u64>,
}

/// Tokens in the agent's context window, from its latest model call.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub used: u64,
    pub window: u64,
    /// The window is guessed from the model id: the agent hasn't said it yet.
    pub estimated: bool,
}

/// Where an adapter sends what it learns. The runtime implements it: it persists
/// rows and emits them to the renderer.
pub trait JournalSink: Send + Sync {
    /// Add or replace a row (by `id`, keeping the higher `revision`).
    fn row(&self, row: JournalRow);
    fn info(&self, info: SessionInfo);
    /// The agent process ended; `reason` says why when it wasn't asked to.
    fn exited(&self, reason: Option<String>);
}

/// One running agent of some brand. Methods return quickly: results arrive as rows.
pub trait AgentAdapter: Send {
    /// Start a user turn.
    fn send(&mut self, message: UserMessage) -> Result<(), String>;
    /// Resolve an approval or question row by its `request_id`.
    fn answer(&mut self, request_id: &str, answer: Answer) -> Result<(), String>;
    /// Stop the current turn and keep the agent. Running subagents stop too,
    /// background ones included.
    fn interrupt(&mut self) -> Result<(), String>;
    /// Stop one subagent or background task, named by the call that started it.
    fn stop_subagent(&mut self, _call_id: &str) -> Result<(), String> {
        Err("This agent can't stop one subagent on its own.".to_string())
    }
    /// Apply picked options (`options::pick`): only the fields set. True when
    /// the agent takes them without a restart; false when they wait for its
    /// next start.
    fn set_options(&mut self, _changes: &AgentOptions) -> Result<bool, String> {
        Ok(false)
    }
    /// End the agent.
    fn stop(&mut self);
    /// Let go of the agent and leave it running where it is (a cloud sandbox),
    /// for a later start to rejoin. False when it can't outlive trace here.
    fn detach(&mut self) -> bool {
        false
    }
    /// The agent's process id, for the interrupted-agents ledger.
    fn pid(&self) -> Option<u32> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::SessionInfo;

    #[test]
    fn background_subagents_keep_an_agent_at_work_after_its_turn() {
        let idle = SessionInfo::default();
        assert!(!idle.at_work());
        let in_turn = SessionInfo {
            busy: true,
            ..SessionInfo::default()
        };
        assert!(in_turn.at_work());
        // The turn ended, but background subagents still run: a restart cuts them off.
        let waiting_on_subagents = SessionInfo {
            running_subagents: 5,
            ..SessionInfo::default()
        };
        assert!(waiting_on_subagents.at_work());
    }
}
