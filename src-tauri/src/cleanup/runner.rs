//! The background pass: a plain OS thread (per the PTY-pump convention) that
//! sweeps once shortly after launch and then hourly, while auto-cleanup is on.
//!
//! Only the process leading the scheduler sweeps (`schedule::runner`'s
//! `flock`): a packaged trace.app and a `tauri dev` build share the config
//! dir, and both removing the same worktree would race.

use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::{settings, sweep};
use crate::state::AppState;

/// Let launch settle (provider restore, the scheduler taking its lock) first.
const FIRST_PASS_AFTER: Duration = Duration::from_secs(2 * 60);
/// Idle periods are measured in hours at the finest, so hourly is plenty.
const EVERY: Duration = Duration::from_secs(60 * 60);

/// Start the loop. Call once, at app setup.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_PASS_AFTER);
        loop {
            tick(&app);
            std::thread::sleep(EVERY);
        }
    });
}

fn tick(app: &AppHandle) {
    let rules = settings::load();
    if !rules.enabled || crate::schedule::runner::ensure_leader().is_err() {
        return;
    }
    let ctx = sweep::Context::snapshot(&app.state::<AppState>());
    sweep::apply(app, &rules, &ctx);
}
