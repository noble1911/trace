//! The scheduler loop: a plain OS thread (per the PTY-pump convention) that
//! wakes every few seconds, retires runs that exited or overran their timeout,
//! and fires prompts that are due.
//!
//! It only runs while trace is open. A firing noticed more than `MISSED_AFTER`
//! late — the Mac slept, or trace was closed — is skipped rather than run late
//! (a 9am report arriving at 4pm is noise), and the prompt moves on to its next
//! slot.
//!
//! Only one trace process fires schedules: a packaged trace.app and a
//! `tauri dev` build share the config dir, and both firing would double every
//! run. An exclusive `flock` decides; the other keeps retrying, so it takes over
//! when the leader quits.

use std::fs::File;
use std::os::unix::io::AsRawFd;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use super::model::{RunStatus, Trigger};
use super::{now_secs, run, store};
use crate::helpers::{restrict_perms, trace_dir};
use crate::state::AppState;

const TICK: Duration = Duration::from_secs(5);

/// How late (secs) a firing may be noticed and still run.
const MISSED_AFTER: i64 = 120;

/// Whether this process holds the scheduler lock. Live runs are tracked
/// in-memory per process, so only the leader may start, stop or delete runs —
/// otherwise a second trace could launch a prompt the leader is already running.
static LEADING: AtomicBool = AtomicBool::new(false);

/// Refuse run-affecting actions in a process that isn't the scheduler.
pub fn ensure_leader() -> Result<(), String> {
    if LEADING.load(Ordering::SeqCst) {
        return Ok(());
    }
    Err(
        "Another trace instance (e.g. the installed app) is running the schedules — use that \
         one, or quit it and try again."
            .to_string(),
    )
}

/// Start the loop. Call once, at app setup.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        // Held for the process lifetime once acquired; dropping it releases.
        let mut leader: Option<File> = None;
        loop {
            if leader.is_none() {
                leader = try_lead();
                if leader.is_some() {
                    LEADING.store(true, Ordering::SeqCst);
                    fail_orphaned_runs(&app);
                }
            }
            reap(&app);
            if leader.is_some() {
                fire_due(&app);
            }
            std::thread::sleep(TICK);
        }
    });
}

/// Take the scheduler lock without blocking; `None` if another trace holds it.
fn try_lead() -> Option<File> {
    let dir = trace_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join("scheduler.lock");
    let file = File::create(&path).ok()?;
    restrict_perms(&path);
    // SAFETY: `flock` on a valid, owned fd; the lock lives as long as `file`.
    let locked = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0;
    locked.then_some(file)
}

/// On becoming leader, any run still marked running that this process doesn't
/// own was cut off when its trace quit.
fn fail_orphaned_runs(app: &AppHandle) {
    let state = app.state::<AppState>();
    let own: Vec<String> = state
        .live_runs
        .lock()
        .values()
        .map(|r| r.run_id.clone())
        .collect();
    let _ = store::update_runs(|runs| {
        let orphaned = runs
            .iter_mut()
            .filter(|r| r.status == RunStatus::Running && !own.contains(&r.id));
        for r in orphaned {
            r.status = RunStatus::Failed;
            r.error = Some("trace was closed while this run was going.".to_string());
        }
    });
}

/// Finish runs whose agent exited on its own or that ran past their deadline.
fn reap(app: &AppHandle) {
    let state = app.state::<AppState>();
    let live: Vec<(String, run::LiveRun)> = state
        .live_runs
        .lock()
        .iter()
        .map(|(ws, r)| (ws.clone(), r.clone()))
        .collect();
    let now = now_secs();
    for (ws, live_run) in live {
        let exited = live_run.spawned && !state.pty_sessions.lock().contains_key(&ws);
        if exited {
            let error = "The agent exited before finishing its turn.".to_string();
            run::finish(app, &ws, RunStatus::Failed, Some(error));
        } else if live_run.deadline.is_some_and(|d| now >= d) {
            run::finish(app, &ws, RunStatus::TimedOut, None);
        }
    }
}

fn fire_due(app: &AppHandle) {
    let now = now_secs();
    // Cheap unlocked peek first, so an idle tick never rewrites the file.
    let pending = store::prompts()
        .iter()
        .any(|p| p.enabled && p.next_run_at.is_none_or(|next| next <= now));
    if !pending {
        return;
    }
    // Decide under the prompts lock; start runs after releasing it (starting
    // takes the runs lock, and the two are never held together).
    let decided = store::update_prompts(|prompts| {
        let mut due = Vec::new();
        for p in prompts.iter_mut().filter(|p| p.enabled) {
            if let Some(next) = p.next_run_at {
                if next > now {
                    continue;
                }
                if now - next <= MISSED_AFTER {
                    due.push(p.id.clone());
                }
            }
            p.next_run_at = p.schedule.next_after(now, p.anchor_at);
        }
        due
    });
    let Ok(due) = decided else {
        return;
    };
    for prompt_id in due {
        match run::live_workspace_for(app, &prompt_id) {
            Some(ws) => run::note_skipped(app, &ws),
            None => {
                let _ = run::start(app, &prompt_id, Trigger::Schedule);
            }
        }
    }
    // Next-run times moved — let the list refresh its "next in …".
    let _ = app.emit("schedules-changed", ());
}
