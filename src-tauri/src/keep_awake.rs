//! Keeping the computer awake while agents work, so a long run isn't cut off by the
//! machine going to sleep. The display may still sleep: only idle system sleep is held.
//!
//! Held exactly while the setting is on and at least one agent trace hosts is live
//! ([`should_hold`]). "Live" is: a ticket or session agent on either transport (a
//! terminal PTY or a chat process), a scheduled run, and a cloud-sandbox agent trace is
//! attached to (trace has to stay connected to it). The Terminal tab's plain shell
//! (`term:`) isn't an agent. Those are the two registries every start and exit already
//! goes through (`AppState::pty_sessions`, `AppState::chat_agents`), so the count is read
//! from them rather than from calls at each start and exit.
//!
//! One worker thread owns the hold: it re-reads the count every few seconds, and
//! [`sync`] wakes it at once (the setting changed). The OS call is made and undone on that
//! one long-lived thread, which Windows' per-thread request needs and which keeps
//! `PR_SET_PDEATHSIG` on Linux tied to a thread that outlives every hold. Idle sleep
//! takes minutes to arrive, so a few seconds of lag in noticing an agent is harmless.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::platform::ports::{SleepHold, SleepInhibitor};
use crate::platform::Os;
use crate::state::AppState;

pub mod settings;

/// How often the worker re-reads the live count when nothing woke it.
const POLL: Duration = Duration::from_secs(5);
/// How long quitting waits for the hold to be released.
const RELEASE_WAIT: Duration = Duration::from_secs(1);

/// Whether the computer should be held awake.
pub fn should_hold(enabled: bool, live_agents: usize) -> bool {
    enabled && live_agents > 0
}

/// How many live agents there are: every PTY except the Terminal tab's plain shells,
/// plus every chat agent (starting and stopping ones still have a process).
pub fn count_agents<'a>(pty_ids: impl Iterator<Item = &'a str>, chat_agents: usize) -> usize {
    pty_ids.filter(|id| !id.starts_with("term:")).count() + chat_agents
}

fn live_agents(state: &AppState) -> usize {
    let ptys = state.pty_sessions.lock();
    let chats = state.chat_agents.workspaces().len();
    count_agents(ptys.keys().map(String::as_str), chats)
}

/// The hold itself, with how to take one. Idempotent: applying the same wish twice
/// does nothing the second time.
pub struct Holder {
    acquire: Box<dyn Fn() -> Option<SleepHold> + Send>,
    hold: Option<SleepHold>,
    /// The machine can't be held (no `systemd-inhibit`): don't retry on every poll.
    unavailable: bool,
}

impl Holder {
    pub fn new(acquire: impl Fn() -> Option<SleepHold> + Send + 'static) -> Self {
        Self {
            acquire: Box::new(acquire),
            hold: None,
            unavailable: false,
        }
    }

    /// Move to `want`: take the hold on the way up, drop it on the way down, and
    /// touch the OS only on those transitions.
    pub fn apply(&mut self, want: bool) {
        if !want {
            self.hold = None;
            self.unavailable = false;
        } else if self.hold.is_none() && !self.unavailable {
            self.hold = (self.acquire)();
            self.unavailable = self.hold.is_none();
        }
    }
}

enum Message {
    Sync,
    Release(Sender<()>),
}

static WORKER: OnceLock<Sender<Message>> = OnceLock::new();
static ENABLED: AtomicBool = AtomicBool::new(true);

/// Start the worker. Call once, at app setup.
pub fn start(app: AppHandle) {
    ENABLED.store(settings::load(), Ordering::SeqCst);
    let (tx, rx) = mpsc::channel();
    if WORKER.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || {
        let mut holder = Holder::new(<Os as SleepInhibitor>::hold);
        loop {
            match rx.recv_timeout(POLL) {
                Ok(Message::Release(done)) => {
                    holder.apply(false);
                    let _ = done.send(());
                    return;
                }
                Ok(Message::Sync) | Err(RecvTimeoutError::Timeout) => {
                    let live = app.try_state::<AppState>().map_or(0, |s| live_agents(&s));
                    holder.apply(should_hold(ENABLED.load(Ordering::SeqCst), live));
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    });
}

/// Re-decide now, instead of at the next poll.
pub fn sync() {
    if let Some(worker) = WORKER.get() {
        let _ = worker.send(Message::Sync);
    }
}

/// Whether the setting is on.
pub fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Turn the setting on or off, saving it, and apply it at once.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    settings::save(enabled)?;
    ENABLED.store(enabled, Ordering::SeqCst);
    sync();
    Ok(())
}

/// Let go for good, as trace quits, and wait for it so no child is left behind.
pub fn release_blocking() {
    let Some(worker) = WORKER.get() else { return };
    let (done, wait) = mpsc::channel();
    if worker.send(Message::Release(done)).is_ok() {
        let _ = wait.recv_timeout(RELEASE_WAIT);
    }
}

#[cfg(test)]
#[path = "keep_awake_tests.rs"]
mod tests;
