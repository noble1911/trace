//! Custom boards: boards the user makes in trace, with their own columns and
//! cards, kept in `custom-boards.json`. One more adapter behind
//! `issues::IssueProvider`, so the board, agents and agent tools treat them like
//! any tracker's. It has no login and is always connected (`issues::session`).
//!
//! A column is one status (its id is the status id) with a category, so
//! auto-start and cleanup work from what a column means. Card keys are
//! `local-<n>`, one counter across every board. See `docs/BOARDS_PLAN.md`.

pub mod cards;
pub mod counter;
pub mod edit;
pub mod model;
mod ops;
pub mod store;
pub mod template;
pub mod types;
pub mod view;

use std::path::PathBuf;

use crate::issues::models::{BoardData, BoardSummary, IssueComment, IssueUser, PullRequest};
use crate::issues::{IssueProvider, ProviderKind, ProviderSession, Via};

pub use model::is_card_key;

/// What comments posted on a custom card are signed with. trace has no cheap,
/// portable way to the OS user's name, and there's only ever one user here.
const COMMENT_AUTHOR: &str = view::LOCAL_USER_NAME;

/// The custom-boards "connection": just where the file is. Cloned freely into
/// `AppState.providers` like the trackers' connections.
#[derive(Clone)]
pub struct CustomBoards {
    path: PathBuf,
    /// Whether a new card's key skips ones this machine has a worktree or repo
    /// assignment for (`counter::taken_here`). Off in tests, whose temp boards
    /// mustn't depend on the machine's repos.
    check_machine: bool,
}

impl Default for CustomBoards {
    fn default() -> Self {
        Self::new()
    }
}

impl CustomBoards {
    /// The boards in the app config dir.
    pub fn new() -> Self {
        Self {
            path: store::default_path(),
            check_machine: true,
        }
    }

    /// Boards kept at `path` (tests).
    #[cfg(test)]
    pub fn at(path: PathBuf) -> Self {
        Self {
            path,
            check_machine: false,
        }
    }
}

/// The name of the board card `key` is on, for an agent's context. `None` when
/// the file can't be read or the card is gone.
pub fn board_name_for_key(key: &str) -> Option<String> {
    let file = store::load(&store::default_path()).ok()?;
    file.find_card(key).map(|(board, _)| board.name.clone())
}

impl IssueProvider for CustomBoards {
    async fn current_user(&self) -> Result<IssueUser, String> {
        Ok(view::local_user())
    }

    async fn list_boards(&self) -> Result<Vec<BoardSummary>, String> {
        let file = store::load(&self.path)?;
        Ok(file.boards.iter().map(view::summary).collect())
    }

    async fn get_board(&self, board_id: &str) -> Result<BoardData, String> {
        let file = store::load(&self.path)?;
        file.board(board_id)
            .map(view::board_data)
            .ok_or_else(|| edit::no_board(board_id))
    }

    async fn transition_issue(
        &self,
        issue_key: &str,
        target_status_ids: &[String],
    ) -> Result<(), String> {
        store::edit(&self.path, |f| {
            cards::transition(f, issue_key, target_status_ids)
        })
    }

    async fn add_comment(&self, issue_key: &str, body: &str) -> Result<(), String> {
        let created = model::now_iso();
        store::edit(&self.path, |f| {
            cards::add_comment(f, issue_key, COMMENT_AUTHOR, created, body)
        })
    }

    async fn list_comments(&self, issue_id: &str) -> Result<Vec<IssueComment>, String> {
        let file = store::load(&self.path)?;
        Ok(file
            .find_card(issue_id)
            .map(|(_, card)| view::comments(card))
            .unwrap_or_default())
    }

    /// No dev-status integration: agents' PRs show through the PR watcher instead.
    async fn get_pull_requests(
        &self,
        _issue_id: &str,
        _fresh: bool,
    ) -> Result<Vec<PullRequest>, String> {
        Ok(Vec::new())
    }

    async fn status_category(&self, issue_key: &str) -> Result<String, String> {
        let file = store::load(&self.path)?;
        let (board, card) = file
            .find_card(issue_key)
            .ok_or_else(|| format!("There's no card {issue_key}."))?;
        Ok(view::issue(board, card).status_category)
    }

    fn session_info(&self) -> ProviderSession {
        ProviderSession {
            provider: ProviderKind::Custom,
            site: None,
            email: None,
            via: Via::Local,
        }
    }
}

#[cfg(test)]
mod tests;
