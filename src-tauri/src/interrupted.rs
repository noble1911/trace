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
//! Scheduled runs (`sched:`) aren't listed: the scheduler owns their lifecycle.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::Ordering;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::helpers::{restrict_perms, trace_dir};
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
}

/// Serialises ledger read-modify-writes across spawn/exit threads.
static LEDGER: Mutex<()> = Mutex::new(());

fn ledger_file() -> PathBuf {
    trace_dir().join("running-agents.json")
}

fn read() -> BTreeMap<String, AgentLaunch> {
    std::fs::read_to_string(ledger_file())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write(agents: &BTreeMap<String, AgentLaunch>) {
    let path = ledger_file();
    if let Ok(json) = serde_json::to_string_pretty(agents) {
        if std::fs::write(&path, json).is_ok() {
            restrict_perms(&path);
        }
    }
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
    let _guard = LEDGER.lock();
    let mut agents = read();
    agents.insert(launch.workspace_id.clone(), launch);
    write(&agents);
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
    let _guard = LEDGER.lock();
    let mut agents = read();
    if agents.remove(workspace_id).is_some() {
        write(&agents);
    }
}

/// At launch: move the agents the last session left behind into `interrupted`.
/// Ones whose process is still alive belong to another running trace and stay
/// in the ledger.
pub fn collect_at_launch(state: &AppState) {
    let _guard = LEDGER.lock();
    let (alive, gone): (BTreeMap<_, _>, BTreeMap<_, _>) =
        read().into_iter().partition(|(_, a)| a.pid.is_some_and(process_alive));
    write(&alive);
    *state.interrupted.lock() = gone.into_values().collect();
}

fn process_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // Signal 0 checks existence without sending anything.
    unsafe { libc::kill(pid, 0) == 0 }
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
