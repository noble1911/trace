//! Issue-tracker providers. The board is provider-agnostic: it renders whatever
//! an `IssueProvider` returns. Several providers can be connected at once (e.g.
//! Jira + Pylon); `AppState` holds one connection per `ProviderKind`.
//!
//! Each provider owns its auth/client modules (`jira/`, `pylon/`); this module
//! holds the shared interface and the `Provider` enum stored in `AppState`.

pub mod models;
pub mod session;

use serde::Serialize;

use crate::jira::JiraConnection;
use crate::pylon::PylonConnection;

use models::{BoardData, BoardSummary, IssueComment, IssueUser, PullRequest};

/// Which tracker a session belongs to. Serialized to the frontend so the UI can
/// show provider-specific affordances (e.g. Jira's epic links).
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Jira,
    Pylon,
}

impl ProviderKind {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "jira" => Ok(ProviderKind::Jira),
            "pylon" => Ok(ProviderKind::Pylon),
            other => Err(format!("Unknown provider: {other}")),
        }
    }
}

/// The active provider connection. Tokens are secret — they stay in the Rust
/// process and a `0600` config file, and are never serialized to the frontend.
#[derive(Clone)]
pub enum Provider {
    Jira(JiraConnection),
    Pylon(PylonConnection),
}

impl Provider {
    pub fn kind(&self) -> ProviderKind {
        match self {
            Provider::Jira(_) => ProviderKind::Jira,
            Provider::Pylon(_) => ProviderKind::Pylon,
        }
    }
}

/// The non-secret session descriptor the UI needs (which provider, plus the
/// Jira site/email for display and browse links). Never carries tokens.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSession {
    pub provider: ProviderKind,
    pub site: Option<String>,
    pub email: Option<String>,
}

/// The interface every issue tracker implements. Board ids are opaque strings
/// (Jira's are numeric; Pylon's are virtual).
pub trait IssueProvider {
    /// Validate the connection and resolve the authenticated user.
    fn current_user(&self) -> impl std::future::Future<Output = Result<IssueUser, String>> + Send;

    /// Boards the user can pick from (virtual on providers without boards).
    fn list_boards(&self) -> impl std::future::Future<Output = Result<Vec<BoardSummary>, String>> + Send;

    /// Columns + cards for one board.
    fn get_board(&self, board_id: &str)
        -> impl std::future::Future<Output = Result<BoardData, String>> + Send;

    /// Move an issue to one of the target statuses (a column can map to several).
    fn transition_issue(
        &self,
        issue_key: &str,
        target_status_ids: &[String],
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    /// Post a plain-text comment/note on an issue.
    fn add_comment(
        &self,
        issue_key: &str,
        body: &str,
    ) -> impl std::future::Future<Output = Result<(), String>> + Send;

    /// Recent entries in the issue's discussion thread, oldest-first (Jira
    /// comments; Pylon conversation incl. internal notes). Providers without
    /// a readable thread return an empty list.
    fn list_comments(
        &self,
        issue_id: &str,
    ) -> impl std::future::Future<Output = Result<Vec<IssueComment>, String>> + Send;

    /// PRs linked to an issue. Providers without a dev-status integration
    /// return an empty list (the UI just renders no badge).
    fn get_pull_requests(
        &self,
        issue_id: &str,
        fresh: bool,
    ) -> impl std::future::Future<Output = Result<Vec<PullRequest>, String>> + Send;

    /// The non-secret session descriptor for `provider_session`.
    fn session_info(&self) -> ProviderSession;
}

impl IssueProvider for Provider {
    async fn current_user(&self) -> Result<IssueUser, String> {
        match self {
            Provider::Jira(c) => c.current_user().await,
            Provider::Pylon(c) => c.current_user().await,
        }
    }

    async fn list_boards(&self) -> Result<Vec<BoardSummary>, String> {
        match self {
            Provider::Jira(c) => c.list_boards().await,
            Provider::Pylon(c) => c.list_boards().await,
        }
    }

    async fn get_board(&self, board_id: &str) -> Result<BoardData, String> {
        match self {
            Provider::Jira(c) => c.get_board(board_id).await,
            Provider::Pylon(c) => c.get_board(board_id).await,
        }
    }

    async fn transition_issue(&self, issue_key: &str, target_status_ids: &[String]) -> Result<(), String> {
        match self {
            Provider::Jira(c) => c.transition_issue(issue_key, target_status_ids).await,
            Provider::Pylon(c) => c.transition_issue(issue_key, target_status_ids).await,
        }
    }

    async fn add_comment(&self, issue_key: &str, body: &str) -> Result<(), String> {
        match self {
            Provider::Jira(c) => c.add_comment(issue_key, body).await,
            Provider::Pylon(c) => c.add_comment(issue_key, body).await,
        }
    }

    async fn list_comments(&self, issue_id: &str) -> Result<Vec<IssueComment>, String> {
        match self {
            Provider::Jira(c) => c.list_comments(issue_id).await,
            Provider::Pylon(c) => c.list_comments(issue_id).await,
        }
    }

    async fn get_pull_requests(&self, issue_id: &str, fresh: bool) -> Result<Vec<PullRequest>, String> {
        match self {
            Provider::Jira(c) => c.get_pull_requests(issue_id, fresh).await,
            Provider::Pylon(c) => c.get_pull_requests(issue_id, fresh).await,
        }
    }

    fn session_info(&self) -> ProviderSession {
        match self {
            Provider::Jira(c) => c.session_info(),
            Provider::Pylon(c) => c.session_info(),
        }
    }
}
