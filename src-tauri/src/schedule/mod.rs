//! Scheduled prompts — a prompt that runs itself on a schedule.
//!
//! Each prompt owns one worktree (like an exploratory session) and every firing
//! is a *run*: a fresh interactive Claude conversation in a PTY keyed
//! `sched:<runId>`, so the live terminal, scrollback replay and stop plumbing
//! shared by board agents and sessions work on it unchanged. The engine lives in
//! Rust (`runner`) so it fires whatever the renderer is doing — but only while
//! trace is open.
//!
//! - `timing` / `cron`: when a schedule fires next.
//! - `model` / `store` / `prompts`: the persisted shapes, their files, and CRUD.
//! - `run`: launching and finishing one run; `completion` decides when its work
//!   (background tasks included) is done, from `claude::hooks` turn events.
//! - `transcript`: a finished run's PTY bytes on disk, replayable after restart.
//! - `template`: `{date}`-style variables substituted into the prompt.
//! - `handoff`: continuing a finished run as an exploratory session.

pub mod completion;
pub mod cron;
pub mod handoff;
pub mod model;
pub mod prompts;
pub mod run;
pub mod runner;
pub mod store;
pub mod template;
pub mod timing;
pub mod transcript;

/// Workspace-id prefix of a run's PTY. Tells runs apart from issue keys, session
/// ids and `term:` shells everywhere a workspace id flows (mirrored in the
/// frontend's `domains/schedules/ids.ts`).
pub const RUN_PREFIX: &str = "sched:";

/// The workspace id a run's PTY, output history and conversation are keyed by.
pub fn run_workspace_id(run_id: &str) -> String {
    format!("{RUN_PREFIX}{run_id}")
}

/// Current time as epoch seconds — the unit every schedule timestamp uses.
pub fn now_secs() -> i64 {
    chrono::Utc::now().timestamp()
}
