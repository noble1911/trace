//! One issue over MCP: moving it, its internal notes, its thread, its status.
//! Same behaviour as the REST adapter's (`pylon::board`).

use serde_json::json;

use super::tools::{self, issue_arg, page_args};
use super::{parse, PylonMcp};
use crate::issues::models::IssueComment;
use crate::mcp_client::args::Arg;
use crate::mcp_client::ToolCaller;
use crate::pylon::board::{note_html, MAX_MESSAGES};
use crate::pylon::models::state_category;

const MESSAGE_PAGE: usize = 100;
/// Runaway guard on top of `MAX_MESSAGES` (a server that ignores `limit`).
const MAX_MESSAGE_PAGES: usize = 10;

/// Move an issue to the first target state. Pylon has no workflow gates: the
/// state is just set, by slug, as on REST (`PATCH /issues/{id}`).
pub async fn transition<T: ToolCaller>(
    c: &PylonMcp<T>,
    key: &str,
    target_state_slugs: &[String],
) -> Result<(), String> {
    let Some(state) = target_state_slugs.first() else {
        return Err("No target status given.".to_string());
    };
    let to = Arg::must(vec![
        ("state", json!(state)),
        ("status", json!(state)),
        ("state_slug", json!(state)),
    ]);
    c.call(&tools::UPDATE, vec![issue_arg(key), to]).await?;
    Ok(())
}

/// Post an **internal note** (Pylon's comment equivalent), never a reply:
/// a reply goes to the customer and can't be unsent. HTML for a `body_html`
/// argument, as on REST; the plain text under any other name.
pub async fn add_note<T: ToolCaller>(c: &PylonMcp<T>, key: &str, text: &str) -> Result<(), String> {
    let html = note_html(text)?;
    let plain = text.trim();
    let body = Arg::must(vec![
        ("body_html", json!(html)),
        ("body", json!(plain)),
        ("message", json!(plain)),
        ("content", json!(plain)),
        ("note", json!(plain)),
        ("text", json!(plain)),
    ]);
    c.call(&tools::NOTE, vec![issue_arg(key), body]).await?;
    Ok(())
}

/// The issue's whole thread (customer messages and internal notes, flagged),
/// oldest-first, at most `MAX_MESSAGES`.
pub async fn list_comments<T: ToolCaller>(
    c: &PylonMcp<T>,
    issue_id: &str,
) -> Result<Vec<IssueComment>, String> {
    let mut out = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..MAX_MESSAGE_PAGES {
        let mut args = page_args(MESSAGE_PAGE, cursor.as_deref());
        args.push(issue_arg(issue_id));
        let v = c.call(&tools::MESSAGES, args).await?;
        let page = parse::messages(&v);
        let empty = page.is_empty();
        out.extend(page);
        cursor = parse::next_cursor(&v);
        if empty || cursor.is_none() || out.len() >= MAX_MESSAGES {
            break;
        }
    }
    // REST sends them oldest-first; put them so if every one has a time.
    if out.iter().all(|(at, _)| at.is_some()) {
        out.sort_by_key(|(at, _)| *at);
    }
    out.truncate(MAX_MESSAGES);
    Ok(out.into_iter().map(|(_, c)| c).collect())
}

/// One issue's status category, from its state slug (`closed` → `done`).
pub async fn status_category<T: ToolCaller>(c: &PylonMcp<T>, key: &str) -> Result<String, String> {
    let v = c.call(&tools::ISSUE, vec![issue_arg(key)]).await?;
    let state = parse::state_of(&v).ok_or_else(|| format!("{key} has no state."))?;
    Ok(state_category(&state))
}
