//! GitHub: the Integrations page's sign-in and repo browser, and the pull
//! requests a workspace's agent raised.
//!
//! - `token`, `api`, `account`, `device`: trace's own GitHub token (pasted,
//!   imported once from `gh`, or from the OAuth device flow), stored user-only in
//!   the config dir, and a REST client that uses it. No `gh` needed.
//! - `repo_list`, `clone`: an owner's repos, and checking one out for agents
//!   (`commands/github.rs`), through `checkout` — the portable clone-and-setup
//!   step a remote runner can reuse.
//! - The PR features below still go through the user's `gh` CLI (`gh`).
//! - `links`: *which* PRs belong to a workspace — its branch's PRs plus any PR
//!   URL the conversation mentions (agents print the URL after `gh pr create`,
//!   but it scrolls off the TUI's screen, which is the whole problem).
//! - `raised`, `pr_lookup`: every PR many workspaces raised, with states, in a
//!   call or two per repo (the Pull requests page).
//! - `thread`: one PR's state + discussion (comments, reviews, inline threads)
//!   with edit timestamps, so the rail can show comments that change in place.

pub mod account;
pub mod accounts;
pub(crate) mod api;
pub mod checkout;
mod checks;
pub mod clone;
pub mod device;
pub(crate) mod gh;
pub mod links;
pub mod pick;
pub mod pr_lookup;
pub mod raised;
pub mod repo_list;
pub mod repo_prs;
pub mod thread;
mod thread_parse;
pub mod token;
