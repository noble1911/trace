//! One issue over MCP: moving it, its internal notes, its thread, its status.
//! Same behaviour as the REST adapter's (`pylon::board`).

use serde_json::json;

use super::tools::{self, page_args};
use super::{parse, thread, PylonMcp};
use crate::issues::models::IssueComment;
use crate::mcp_client::args::Arg;
use crate::mcp_client::ToolCaller;
use crate::pylon::board::{note_html, MAX_MESSAGES};
use crate::pylon::models::state_category;

const MESSAGE_PAGE: usize = 100;
/// Runaway guard on top of `MAX_MESSAGES` (a server that ignores `limit`).
const MAX_MESSAGE_PAGES: usize = 10;

/// Move an issue to the first target state. Pylon has no workflow gates: the
/// state is just set, by slug, as on REST (`PATCH /issues/{id}`). Then checked:
/// the update's answer, or a fresh read of the issue, must show the new state,
/// because a lenient server can accept an argument it ignores, and a move that
/// silently didn't happen would snap the card back with no reason given.
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
    let issue = c.issue_arg(&tools::UPDATE, key).await?;
    let answer = c.call(&tools::UPDATE, vec![issue, to]).await?;
    if parse::state_of(&answer).as_ref() == Some(state) {
        return Ok(());
    }
    let issue = c.issue_arg(&tools::ISSUE, key).await?;
    let now = parse::state_of(&c.call(&tools::ISSUE, vec![issue]).await?);
    match now {
        Some(now) if &now == state => Ok(()),
        Some(now) => Err(format!(
            "Pylon accepted the move of {key}, but it's still in {now}."
        )),
        None => Err(format!(
            "Pylon accepted the move of {key}, but trace couldn't read its state back."
        )),
    }
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
    let issue = c.issue_arg(&tools::NOTE, key).await?;
    c.call(&tools::NOTE, vec![issue, body]).await?;
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
        args.push(c.issue_arg(&tools::MESSAGES, issue_id).await?);
        let v = c.call(&tools::MESSAGES, args).await?;
        let page = thread::messages(&v)?;
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
    let issue = c.issue_arg(&tools::ISSUE, key).await?;
    let v = c.call(&tools::ISSUE, vec![issue]).await?;
    let state = parse::state_of(&v).ok_or_else(|| format!("{key} has no state."))?;
    Ok(state_category(&state))
}
