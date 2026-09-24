//! GitHub pull requests a workspace's agent raised, read through the user's `gh`
//! CLI (so their existing `gh auth` applies — no in-app OAuth).
//!
//! - `links`: *which* PRs belong to a workspace — its branch's PRs plus any PR
//!   URL the conversation mentions (agents print the URL after `gh pr create`,
//!   but it scrolls off the TUI's screen, which is the whole problem).
//! - `thread`: one PR's state + discussion (comments, reviews, inline threads)
//!   with edit timestamps, so the rail can show comments that change in place.

mod checks;
mod gh;
pub mod links;
pub mod repo_prs;
pub mod thread;
mod thread_parse;
