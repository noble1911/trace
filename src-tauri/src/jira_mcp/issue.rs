//! One issue over MCP: moving it, its comments, its status, its linked PRs.

use serde_json::json;

use super::tools::{self, Arg};
use super::{linked, parse, JiraMcp};
use crate::issues::models::{IssueComment, PullRequest};
use crate::mcp_client::ToolCaller;

/// The newest comments kept, as the REST adapter keeps.
const MAX_COMMENTS: usize = 25;

/// The issue argument, under whichever name the tool lists.
fn issue_arg(key: &str) -> Arg {
    Arg::must(vec![
        ("issueIdOrKey", json!(key)),
        ("issueKey", json!(key)),
        ("issueId", json!(key)),
    ])
}

/// Move `key` so it lands on any of `target_status_ids`: the transition whose
/// target is one of them. Errors name where it can go instead, as on REST.
pub async fn transition<T: ToolCaller>(
    c: &JiraMcp<T>,
    key: &str,
    target_status_ids: &[String],
) -> Result<(), String> {
    let v = c
        .call(&tools::TRANSITIONS, vec![c.cloud(), issue_arg(key)])
        .await?;
    let transitions = parse::transitions(&v);
    let chosen = transitions
        .iter()
        .find(|t| target_status_ids.contains(&t.to_id));
    let Some(chosen) = chosen else {
        let allowed: Vec<&str> = transitions
            .iter()
            .map(|t| t.to_name.as_str())
            .filter(|n| !n.is_empty())
            .collect();
        return Err(if allowed.is_empty() {
            format!("{key} has no available transitions from its current status.")
        } else {
            format!(
                "Jira's workflow won't move {key} there directly. Allowed from here: {}.",
                allowed.join(", ")
            )
        });
    };
    let to = Arg::must(vec![
        ("transition", json!({ "id": chosen.id })),
        ("transitionId", json!(chosen.id)),
    ]);
    c.call(&tools::TRANSITION, vec![c.cloud(), issue_arg(key), to])
        .await?;
    Ok(())
}

/// Post a plain-text comment (sent as Markdown, which plain text is).
pub async fn add_comment<T: ToolCaller>(
    c: &JiraMcp<T>,
    key: &str,
    text: &str,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Comment body is empty.".to_string());
    }
    let body = Arg::must(vec![
        ("commentBody", json!(text)),
        ("body", json!(text)),
        ("comment", json!(text)),
    ]);
    let format = Arg::opt(vec![("contentFormat", json!("markdown"))]);
    c.call(
        &tools::COMMENT,
        vec![c.cloud(), issue_arg(key), body, format],
    )
    .await?;
    Ok(())
}

/// The issue's newest comments, oldest first. From `listJiraIssueComments`,
/// else (no such tool, or it failed) from the issue's comment field.
pub async fn list_comments<T: ToolCaller>(
    c: &JiraMcp<T>,
    issue_id: &str,
) -> Result<Vec<IssueComment>, String> {
    let adf = || Arg::opt(vec![("responseContentFormat", json!("adf"))]);
    let listed = match c.offers(&tools::COMMENTS).await {
        true => {
            let args = vec![
                c.cloud(),
                issue_arg(issue_id),
                Arg::opt(vec![("orderBy", json!("-created"))]),
                Arg::opt(vec![("maxResults", json!(MAX_COMMENTS * 2))]),
                adf(),
            ];
            c.call(&tools::COMMENTS, args).await.ok()
        }
        false => None,
    };
    let v = match listed {
        Some(v) => v,
        None => {
            let fields = Arg::opt(vec![("fields", json!(["comment"]))]);
            let args = vec![c.cloud(), issue_arg(issue_id), fields, adf()];
            c.call(&tools::ISSUE, args).await?
        }
    };
    let mut comments = parse::comments(&v);
    let extra = comments.len().saturating_sub(MAX_COMMENTS);
    comments.drain(..extra);
    Ok(comments)
}

/// One issue's status category key, for housekeeping without a board.
pub async fn status_category<T: ToolCaller>(c: &JiraMcp<T>, key: &str) -> Result<String, String> {
    let fields = Arg::opt(vec![("fields", json!(["status"]))]);
    let v = c
        .call(&tools::ISSUE, vec![c.cloud(), issue_arg(key), fields])
        .await?;
    parse::status_category(&v).ok_or_else(|| format!("{key} has no status."))
}

/// PRs linked to the issue, from the Teamwork Graph. Best effort: no tool, or
/// a failed call, is no PRs (the badge is a nicety, not worth an error).
pub async fn pull_requests<T: ToolCaller>(
    c: &JiraMcp<T>,
    issue_id: &str,
) -> Result<Vec<PullRequest>, String> {
    if !c.offers(&tools::LINKED).await {
        return Ok(Vec::new());
    }
    let cloud = Arg::opt(vec![("cloudId", json!(c.site().id))]);
    let entity = Arg::must(vec![
        ("issueIdOrKey", json!(issue_id)),
        ("entityId", json!(issue_id)),
        ("id", json!(issue_id)),
    ]);
    let found = c.call(&tools::LINKED, vec![cloud, entity]).await;
    Ok(found.map(|v| linked::pull_requests(&v)).unwrap_or_default())
}
