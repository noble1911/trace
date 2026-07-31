//! Jira Cloud provider. Columns come from the user's board configuration and
//! cards from their active sprint. See `.claude/rules/jira.md`.

pub mod auth;
pub mod board;
pub mod client;
pub mod comments;
pub mod dev;
pub mod parse;

use crate::issues::models::{BoardData, BoardSummary, IssueComment, IssueUser, PullRequest};
use crate::issues::{IssueProvider, ProviderKind, ProviderSession};

/// An authenticated Jira connection. `token` is secret — it stays in the Rust
/// process and a `0600` config file, and is never serialized to the frontend.
#[derive(Clone)]
pub struct JiraConnection {
    /// Site host, e.g. `your-org.atlassian.net`.
    pub site: String,
    pub email: String,
    pub token: String,
}

impl JiraConnection {
    /// Base URL for REST calls, e.g. `https://your-org.atlassian.net`.
    pub fn base_url(&self) -> String {
        let site = self.site.trim().trim_end_matches('/');
        if site.starts_with("http://") || site.starts_with("https://") {
            site.to_string()
        } else {
            format!("https://{site}")
        }
    }
}

impl IssueProvider for JiraConnection {
    async fn current_user(&self) -> Result<IssueUser, String> {
        auth::validate(self).await
    }

    async fn list_boards(&self) -> Result<Vec<BoardSummary>, String> {
        board::list_boards(self).await
    }

    async fn get_board(&self, board_id: &str) -> Result<BoardData, String> {
        let id: i64 = board_id
            .parse()
            .map_err(|_| format!("Invalid Jira board id: {board_id}"))?;
        board::get_board(self, id).await
    }

    async fn transition_issue(&self, issue_key: &str, target_status_ids: &[String]) -> Result<(), String> {
        board::transition_to_status(self, issue_key, target_status_ids).await
    }

    async fn add_comment(&self, issue_key: &str, body: &str) -> Result<(), String> {
        board::add_comment(self, issue_key, body).await
    }

    async fn list_comments(&self, issue_id: &str) -> Result<Vec<IssueComment>, String> {
        comments::list_comments(self, issue_id).await
    }

    async fn get_pull_requests(&self, issue_id: &str, fresh: bool) -> Result<Vec<PullRequest>, String> {
        dev::get_pull_requests(self, issue_id, fresh).await
    }

    fn session_info(&self) -> ProviderSession {
        ProviderSession {
            provider: ProviderKind::Jira,
            site: Some(self.site.clone()),
            email: Some(self.email.clone()),
        }
    }
}
