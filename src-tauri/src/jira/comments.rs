//! Issue comment fetch (`GET /rest/api/3/issue/{id}/comment`). Kept out of
//! `board.rs` (already over its size target) — mirrors `dev.rs` holding the
//! issue-scoped PR fetch.

use serde_json::Value;

use super::client;
use super::parse;
use super::JiraConnection;
use crate::issues::models::IssueComment;

/// How many of the newest comments to fetch — the kickoff brief only needs
/// recent context, and the frontend caps the formatted transcript further.
const MAX_COMMENTS: &str = "25";

/// The issue's most recent comments, oldest-first for transcript formatting.
/// `issue_id` accepts a Jira id or key interchangeably.
pub async fn list_comments(conn: &JiraConnection, issue_id: &str) -> Result<Vec<IssueComment>, String> {
    let path = format!("/rest/api/3/issue/{issue_id}/comment");
    let query = [("orderBy", "-created"), ("maxResults", MAX_COMMENTS)];
    let v = client::get_query(conn, &path, &query).await?;
    let mut comments: Vec<IssueComment> = v
        .get("comments")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(parse::parse_comment).collect())
        .unwrap_or_default();
    // The API returned newest-first; briefs read as a transcript, oldest first.
    comments.reverse();
    Ok(comments)
}
