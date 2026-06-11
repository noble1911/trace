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
///
/// `fresh` adds `resetCache=true`, forcing Jira to re-sync from GitHub
/// instead of serving its cache — Jira's dev-status can hold a stale state
/// (e.g. a closed PR still "open") indefinitely when a webhook was missed.
/// Costs a GitHub round-trip on Jira's side, so callers use it for targeted
/// single-issue refreshes, not bulk fan-outs.
pub async fn get_pull_requests(
    conn: &JiraConnection,
    issue_id: &str,
    fresh: bool,
) -> Result<Vec<PullRequest>, String> {
    let mut query = vec![
        ("issueId", issue_id),
        ("applicationType", "GitHub"),
        ("dataType", "pullrequest"),
    ];
    if fresh {
        query.push(("resetCache", "true"));
    }
    let v = client::get_query(conn, "/rest/dev-status/latest/issue/detail", &query).await?;

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
