//! Agents cut off by trace quitting, updating or crashing — offered back on the
//! next launch.
//!
//! A ledger file (`running-agents.json`, 0600) lists every live agent with what
//! it was started with. An agent leaves it when its process ends on its own (the
//! user stopped it, Claude exited); one killed because trace is going down stays.
//! So at launch, whatever is still listed — and whose process is really gone —
//! was interrupted. Resuming is `spawn_in` again with the same arguments: it
//! resumes the workspace's saved Claude conversation (`--resume`), so the agent
//! carries on rather than starting over. The kickoff brief is never recorded, so
//! it isn't sent twice.
//!
//! A resumed conversation just sits at its prompt, so an agent cut off mid-task
//! is told to carry on (`resume_prompt`). Which ones were mid-task comes from the
//! turn hooks (`claude::hooks`) for a terminal agent and its session info for a
//! chat one (`agent_session::runtime`): a submitted prompt marks the agent busy,
//! a turn that ends with nothing left in the background (no pending tasks, no
//! running subagents) marks it idle. One that was idle — done, or waiting on
//! you — is left waiting.
//!
//! Scheduled runs (`sched:`) aren't listed: the scheduler owns their lifecycle.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::helpers::persist::{self, Style};
use crate::helpers::trace_dir;
use crate::schedule::{now_secs, RUN_PREFIX};
use crate::state::AppState;

/// What an agent was started with — enough to start it again.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentLaunch {
    pub workspace_id: String,
    pub cwd: String,
    pub cli: String,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub extra_args: Vec<String>,
    pub started_at: i64,
    /// The agent's process — still alive at launch means another trace (a dev
    /// build beside the installed one) is running it, so it wasn't interrupted.
    pub pid: Option<u32>,
    /// Mid-turn: started with a prompt, or a prompt submitted since its last
    /// turn ended. An entry from before this was tracked counts as busy.
    #[serde(default = "busy_if_unknown")]
    pub busy: bool,
    /// Chat or terminal; entries from before this was recorded ran in a terminal.
    #[serde(default)]
    pub transport: crate::agent_session::transport::Transport,
}

fn busy_if_unknown() -> bool {
    true
}

/// What a resumed agent that was mid-task is told, as its first prompt.
const RESUME_NUDGE: &str = "trace was restarted while you were working, which cut off your \
last turn and any background tasks or subagents still running. Continue where you left off, \
restarting any of that work you still need.";

/// The prompt to resume an agent with: the nudge for a Claude agent that was
/// mid-task, none for one that was idle. Codex is left alone — it has no saved
/// conversation to carry on.
pub fn resume_prompt(launch: &AgentLaunch) -> Option<String> {
    (launch.cli == "claude" && launch.busy).then(|| RESUME_NUDGE.to_string())
}

fn ledger_file() -> PathBuf {
    trace_dir().join("running-agents.json")
}

/// Read-modify-write the ledger across spawn/exit threads and any other trace. The
/// ledger is a convenience, so a failure is logged rather than failing the agent.
fn update<R: Default>(f: impl FnOnce(&mut BTreeMap<String, AgentLaunch>) -> R) -> R {
    persist::update(&ledger_file(), Style::Pretty, f).unwrap_or_else(|e| {
        eprintln!("trace: {e}");
        R::default()
    })
}

fn tracked(workspace_id: &str) -> bool {
    !workspace_id.starts_with(RUN_PREFIX)
}

/// An agent started: list it.
pub fn record_start(mut launch: AgentLaunch, pid: Option<u32>) {
    if !tracked(&launch.workspace_id) {
        return;
    }
    launch.pid = pid;
    launch.started_at = now_secs();
    update(|agents| {
        agents.insert(launch.workspace_id.clone(), launch);
    });
}

/// An agent's process ended. Unlisted unless trace itself is going down — that
/// one was interrupted, and stays for the next launch to offer back.
pub fn record_exit(app: &AppHandle, workspace_id: &str) {
    let going_down = app
        .try_state::<AppState>()
        .is_none_or(|s| s.shutting_down.load(Ordering::SeqCst));
    if going_down || !tracked(workspace_id) {
        return;
    }
    update(|agents| {
        agents.remove(workspace_id);
    });
}

/// An agent's turn state changed (`claude::hooks`): keep its ledger entry's
/// `busy` in step. Only writes when it actually changes.
pub fn record_busy(workspace_id: &str, busy: bool) {
    if !tracked(workspace_id) {
        return;
    }
    update(|agents| {
        if let Some(a) = agents.get_mut(workspace_id) {
            a.busy = busy;
        }
    });
}

/// At launch: move the agents the last session left behind into `interrupted`.
/// Ones whose process is still alive belong to another running trace and stay
/// in the ledger.
pub fn collect_at_launch(state: &AppState) {
    let gone: BTreeMap<String, AgentLaunch> = update(|agents| {
        let (alive, gone) = std::mem::take(agents)
            .into_iter()
            .partition(|(_, a)| a.pid.is_some_and(process_alive));
        *agents = alive;
        gone
    });
    *state.interrupted.lock() = gone.into_values().collect();
}

/// Workspaces the ledger lists with a live process: this trace's agents and
/// any another running trace started (a dev build beside the installed one),
/// which this one's `AppState` can't see. For refusing to delete a card whose
/// agent is running anywhere. A read failure is logged and lists none.
pub fn live_anywhere() -> Vec<String> {
    let ledger: BTreeMap<String, AgentLaunch> = persist::read_or_log(&ledger_file());
    alive_ids(&ledger, process_alive)
}

fn alive_ids(ledger: &BTreeMap<String, AgentLaunch>, alive: impl Fn(u32) -> bool) -> Vec<String> {
    ledger
        .values()
        .filter(|a| a.pid.is_some_and(&alive))
        .map(|a| a.workspace_id.clone())
        .collect()
}

fn process_alive(pid: u32) -> bool {
    use crate::platform::{ports::ProcessHost, Os};
    Os::is_alive(pid)
}

/// The agents interrupted last time, not yet resumed or dismissed.
pub fn list(state: &AppState) -> Vec<AgentLaunch> {
    state.interrupted.lock().clone()
}

/// Take the given agents off the interrupted list, returning their launches.
pub fn take(state: &AppState, ids: &[String]) -> Vec<AgentLaunch> {
    let mut list = state.interrupted.lock();
    let (taken, kept): (Vec<_>, Vec<_>) =
        list.drain(..).partition(|a| ids.contains(&a.workspace_id));
    *list = kept;
    taken
}

/// Held in `AppState`: the interrupted list for this launch.
pub type Interrupted = Mutex<Vec<AgentLaunch>>;

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(cli: &str, busy: bool) -> AgentLaunch {
        AgentLaunch {
            workspace_id: "TRACE-1".into(),
            cwd: "/tmp".into(),
            cli: cli.into(),
            model: None,
            provider: None,
            extra_args: Vec::new(),
            started_at: 0,
            pid: None,
            busy,
            transport: Default::default(),
        }
    }

    #[test]
    fn only_a_busy_claude_agent_is_told_to_continue() {
        assert!(resume_prompt(&launch("claude", true)).is_some());
        assert!(resume_prompt(&launch("claude", false)).is_none());
        assert!(resume_prompt(&launch("codex", true)).is_none());
    }

    #[test]
    fn only_entries_with_a_live_process_count_as_running() {
        let mut ledger = BTreeMap::new();
        for (id, pid) in [
            ("local-1", Some(10)),
            ("local-2", Some(11)),
            ("local-3", None),
        ] {
            let mut a = launch("claude", true);
            a.workspace_id = id.into();
            a.pid = pid;
            ledger.insert(id.to_string(), a);
        }
        assert_eq!(alive_ids(&ledger, |pid| pid == 10), ["local-1"]);
    }

    #[test]
    fn an_entry_from_before_busy_was_tracked_counts_as_busy() {
        let json = r#"{"workspaceId":"TRACE-1","cwd":"/tmp","cli":"claude","model":null,
            "provider":null,"extraArgs":[],"startedAt":0,"pid":null}"#;
        let a: AgentLaunch = serde_json::from_str(json).unwrap();
        assert!(a.busy);
    }
}
