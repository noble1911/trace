//! Jira "dev-status" lookups — pull requests linked to an issue via the
//! GitHub-for-Jira integration. The endpoint is internal but stable: it's what
//! the "1 pull request" panel on a Jira issue page calls.

use serde_json::Value;

use super::client;
use super::models::PullRequest;
use super::JiraConnection;

/// PRs linked to the issue's numeric id, across configured GitHub instances.
/// Returns an empty list (not an error) when no PRs / no integration — the UI
/// just renders no badge in that case.
pub async fn get_pull_requests(
    conn: &JiraConnection,
    issue_id: &str,
) -> Result<Vec<PullRequest>, String> {
    let v = client::get_query(
        conn,
        "/rest/dev-status/latest/issue/detail",
        &[
            ("issueId", issue_id),
            ("applicationType", "GitHub"),
            ("dataType", "pullrequest"),
        ],
    )
    .await?;

    let mut out = Vec::new();
    for detail in v.get("detail").and_then(Value::as_array).into_iter().flatten() {
        for pr in detail.get("pullRequests").and_then(Value::as_array).into_iter().flatten() {
            // `id` is the PR number (string); status is uppercase ("OPEN", "MERGED", ...).
            let number = pr.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let url = pr.get("url").and_then(Value::as_str).unwrap_or("").to_string();
            let title = pr.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let state = pr
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("OPEN")
                .to_ascii_lowercase();
            if !url.is_empty() {
                out.push(PullRequest { number, url, state, title });
            }
        }
    }
    Ok(out)
}
