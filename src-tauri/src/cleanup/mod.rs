//! Workspace auto-cleanup: deletes the checkouts of sessions and tickets that
//! have sat idle past a user-chosen period, under rules set in Settings →
//! Worktrees (off by default). Each worktree carries a full checkout — often
//! with `node_modules`/`target` — so finished work otherwise piles up on disk.
//!
//! - `settings` — the persisted rules.
//! - `candidates` — which worktrees exist, and when each was last active.
//! - `sweep` — rule evaluation, safety holds, removal.
//! - `runner` — the hourly background pass.

pub mod candidates;
pub mod runner;
pub mod settings;
pub mod sweep;
