//! Jira Cloud integration. Jira is the source of truth for the board: columns
//! come from the user's board configuration and cards from their active sprint.

pub mod auth;
pub mod board;
pub mod client;
pub mod models;

/// An authenticated Jira connection. `token` is secret — it stays in the Rust
/// process and the OS keychain, and is never serialized to the frontend.
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
