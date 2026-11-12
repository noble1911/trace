//! One issue over MCP: moving it, its comments, its status, its linked PRs.

use serde_json::json;

use super::tools;
use super::{linked, parse, JiraMcp};
use crate::issues::models::{IssueComment, PullRequest};
use crate::mcp_client::args::Arg;
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
    // The server names a move's target status but may not give its id: the
    // site's statuses say what the target ids are called.
    let names: Vec<String> = match transitions.iter().any(|t| t.to_id.is_none()) {
        true => super::statuses::names(c, target_status_ids).await,
        false => Vec::new(),
    };
    let chosen = transitions
        .iter()
        .find(|t| t.lands_on(target_status_ids, &names));
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

/// Characters Markdown may read as formatting anywhere in a line.
const INLINE_MARKS: &[char] = &['\\', '`', '*', '_', '[', ']', '<', '~', '|'];

/// `text` as Markdown that renders as exactly that text: every character
/// Markdown could read as formatting backslash-escaped (inline marks anywhere;
/// `#`, `>`, `-`, `+` and `1.` only where they'd start a heading, quote or
/// list). The comment tools take Markdown, and trace's comments are plain text,
/// as the REST adapter posts them: `snake_case` or `*` mustn't become italics.
pub fn markdown_literal(text: &str) -> String {
    let lines: Vec<String> = text.lines().map(escape_line).collect();
    lines.join("\n")
}

fn escape_line(line: &str) -> String {
    let indent = line.len() - line.trim_start().len();
    let (lead, rest) = line.split_at(indent);
    let mut out = lead.to_string();
    let digits = rest.chars().take_while(char::is_ascii_digit).count();
    let block = match rest.chars().next() {
        Some('#' | '>' | '-' | '+') => Some(0),
        _ if digits > 0 && matches!(rest[digits..].chars().next(), Some('.' | ')')) => Some(digits),
        _ => None,
    };
    for (i, ch) in rest.chars().enumerate() {
        if INLINE_MARKS.contains(&ch) || block == Some(i) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Post a plain-text comment, escaped so the Markdown the tools take renders
/// it as written ([`markdown_literal`]).
pub async fn add_comment<T: ToolCaller>(
    c: &JiraMcp<T>,
    key: &str,
    text: &str,
) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Comment body is empty.".to_string());
    }
    let text = markdown_literal(text);
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
    // v2 answers in Markdown or HTML only (no ADF).
    let adf = || Arg::opt(vec![("responseContentFormat", json!("markdown"))]);
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
