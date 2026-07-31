//! Pylon provider. Pylon has no boards or sprints: the board is virtual —
//! columns come from Pylon's issue states (base states plus any custom status
//! slugs seen on issues) and cards from a rolling window of recent issues.
//! See `.claude/rules/providers.md`.

pub mod auth;
pub mod board;
pub mod client;
pub mod models;

use crate::issues::models::{BoardData, BoardSummary, IssueUser, PullRequest};
use crate::issues::{IssueProvider, ProviderKind, ProviderSession};

/// An authenticated Pylon connection (Bearer API token, Admin-generated).
/// `token` is secret — it stays in the Rust process and a `0600` config file,
/// and is never serialized to the frontend.
#[derive(Clone)]
pub struct PylonConnection {
    pub token: String,
    /// API base URL. Pylon is region-sharded: EU tokens 401 on the US endpoint
    /// with a hint pointing at the EU one. `auth::validate` resolves this on
    /// connect; it's persisted with the session.
    pub base_url: String,
}

/// The US endpoint — default until proven otherwise.
pub const US_BASE_URL: &str = "https://api.usepylon.com";
/// The EU endpoint, swapped in when the US one rejects an EU token.
pub const EU_BASE_URL: &str = "https://api.eu.usepylon.com";

impl PylonConnection {
    pub fn new(token: String) -> Self {
        Self {
            token,
            base_url: US_BASE_URL.to_string(),
        }
    }
}

impl IssueProvider for PylonConnection {
    async fn current_user(&self) -> Result<IssueUser, String> {
        Ok(auth::validate(self).await?.0)
    }

    async fn list_boards(&self) -> Result<Vec<BoardSummary>, String> {
        Ok(board::virtual_boards())
    }

    async fn get_board(&self, board_id: &str) -> Result<BoardData, String> {
        board::get_board(self, board_id).await
    }

    async fn transition_issue(&self, issue_key: &str, target_status_ids: &[String]) -> Result<(), String> {
        board::transition_to_state(self, issue_key, target_status_ids).await
    }

    async fn add_comment(&self, issue_key: &str, body: &str) -> Result<(), String> {
        board::add_note(self, issue_key, body).await
    }

    /// Pylon has no dev-status integration — no PR badges on its cards.
    async fn get_pull_requests(&self, _issue_id: &str, _fresh: bool) -> Result<Vec<PullRequest>, String> {
        Ok(Vec::new())
    }

    fn session_info(&self) -> ProviderSession {
        ProviderSession {
            provider: ProviderKind::Pylon,
            site: None,
            email: None,
        }
    }
}
