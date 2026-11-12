//! Atlassian MCP payloads → the shared `issues::models`.
//!
//! The tools that wrap Jira's REST API return its JSON as it is (seen on the
//! v1 server: `searchJiraIssuesUsingJql` gives `{ issues, nextPageToken,
//! isLast }` of REST issues; transitions are REST's), so issues, users and
//! comments go through `jira::parse`. The board tools' payloads aren't
//! documented: each reader here accepts REST's shape and the likely simplified
//! ones (a bare array or another list key, ids as numbers or strings, a status
//! category as a key or a name).
//!
//! What the board is made of is read strictly: a list that isn't there, or
//! whose items none parse, is an error rather than an empty board ([`listed`]).

use std::collections::HashMap;

use serde_json::Value;

use crate::issues::models::{BoardSummary, Issue, IssueComment, IssueUser};
use crate::jira::parse as rest;

/// A status id's name and category key.
pub type StatusMeta = HashMap<String, (String, String)>;

/// The items of a list payload: the value itself, or its first list under `keys`.
/// Lenient (nothing found is no items): for what's best effort.
pub fn items<'a>(v: &'a Value, keys: &[&str]) -> &'a [Value] {
    if let Some(arr) = v.as_array() {
        return arr;
    }
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_array))
        .map_or(&[], Vec::as_slice)
}

/// [`items`] for what the board is made of: Err when there's no list at all,
/// so a payload of another shape never reads as "no boards" or "no issues".
/// `what` names the items in the error (`issues`).
pub fn listed<'a>(v: &'a Value, keys: &[&str], what: &str) -> Result<&'a [Value], String> {
    if let Some(arr) = v.as_array() {
        return Ok(arr);
    }
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_array))
        .map(Vec::as_slice)
        .ok_or_else(|| {
            format!("Atlassian's MCP server sent {what} in a shape trace couldn't read.")
        })
}

/// `parsed` from `raw` items, or Err when there were items and none parsed: a
/// page trace can't read must not show as an empty board.
fn all_unreadable<T>(raw: usize, parsed: Vec<T>, what: &str) -> Result<Vec<T>, String> {
    if raw > 0 && parsed.is_empty() {
        return Err(format!(
            "Atlassian's MCP server sent {raw} {what} trace couldn't read."
        ));
    }
    Ok(parsed)
}

/// A read tool's result, as long as it's JSON trace can read: an object or an
/// array. Anything else (text a server sent instead of JSON, or nothing) is an
/// error quoting it, where reading it as a list would give an empty one.
pub fn readable(tool: &str, v: Value) -> Result<Value, String> {
    if v.is_object() || v.is_array() {
        return Ok(v);
    }
    let said = match &v {
        Value::String(s) => s.trim().chars().take(200).collect::<String>(),
        other => other.to_string(),
    };
    Err(format!(
        "Atlassian's MCP server answered {tool} with something trace couldn't read: {said}"
    ))
}

/// An id, sent as a string or a number.
pub fn id_of(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) if !s.is_empty() => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// The first of `keys` that holds a string: payloads name the same thing
/// differently (`nextPageToken` or `cursor`, `name` or `displayName`).
pub fn text<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

/// The signed-in user: REST's `/myself` shape (`getJiraCurrentUser`) or the
/// profile `atlassianUserInfo` gives (`account_id`, `name`, `picture`). Err
/// without an id: connecting validates the login with this, and a nameless
/// placeholder would let a broken login through.
pub fn user(v: &Value) -> Result<IssueUser, String> {
    let user = if v.get("accountId").is_some() {
        rest::parse_user(v)
    } else {
        IssueUser {
            account_id: text(v, &["account_id", "id"])
                .unwrap_or_default()
                .to_string(),
            display_name: text(v, &["name", "nickname", "displayName"])
                .unwrap_or("Unknown")
                .to_string(),
            email: text(v, &["email", "emailAddress"]).map(str::to_string),
            avatar_url: text(v, &["picture", "avatarUrl"]).map(str::to_string),
        }
    };
    if user.account_id.trim().is_empty() {
        return Err("Atlassian's MCP server didn't say who trace is signed in as.".to_string());
    }
    Ok(user)
}

/// One page of `listJiraBoards`. Err when it isn't a list of boards, or none
/// of its entries read as one.
pub fn boards(v: &Value) -> Result<Vec<BoardSummary>, String> {
    let raw = listed(v, &["values", "boards", "results"], "its boards")?;
    let parsed = raw
        .iter()
        .filter_map(|b| {
            Some(BoardSummary {
                id: id_of(b.get("id").or_else(|| b.get("boardId")))?,
                name: text(b, &["name"])?.to_string(),
                board_type: text(b, &["type", "boardType"])
                    .unwrap_or("scrum")
                    .to_ascii_lowercase(),
            })
        })
        .collect();
    all_unreadable(raw.len(), parsed, "boards")
}

/// A normalised status category key from a key (`new`) or a name (`To Do`,
/// `IN_PROGRESS`, `Done`).
pub(super) fn category(v: Option<&Value>) -> Option<String> {
    let v = v?;
    let raw = v
        .as_str()
        .or_else(|| text(v, &["key", "name"]))?
        .to_ascii_lowercase()
        .replace(['_', ' '], "");
    Some(
        match raw.as_str() {
            "new" | "todo" | "undefined" => "new",
            "done" | "complete" => "done",
            _ => "indeterminate",
        }
        .to_string(),
    )
}

/// `listJiraStatuses`: id → (name, category). One without a category is left
/// out rather than guessed, so the board resolves it another way.
pub fn statuses(v: &Value) -> StatusMeta {
    items(v, &["values", "statuses", "results"])
        .iter()
        .filter_map(|s| {
            let id = id_of(s.get("id"))?;
            let name = text(s, &["name"])?.to_string();
            let cat = category(s.get("statusCategory"))?;
            Some((id, (name, cat)))
        })
        .collect()
}

/// One page of `searchJiraIssuesUsingJql`: its cards and the next page's
/// token. Err when it isn't a list of issues, or none of its issues read.
pub fn issue_page(v: &Value) -> Result<(Vec<Issue>, Option<String>), String> {
    let raw = listed(v, &["issues", "values", "results"], "issues")?;
    let parsed = raw.iter().filter_map(rest::parse_issue).collect();
    let issues = all_unreadable(raw.len(), parsed, "issues")?;
    let last = v.get("isLast").and_then(Value::as_bool) == Some(true);
    let next = text(v, &["nextPageToken"])
        .filter(|t| !t.is_empty() && !last)
        .map(str::to_string);
    Ok((issues, next))
}

/// The running sprint's name in `listJiraBoardSprints` (asked for active ones).
pub fn active_sprint(v: &Value) -> Option<String> {
    let sprints = items(v, &["values", "sprints", "results"]);
    let active = sprints
        .iter()
        .find(|s| text(s, &["state"]).is_none_or(|st| st.eq_ignore_ascii_case("active")))?;
    // A nameless sprint is still a sprint: the board scopes to it.
    Some(text(active, &["name"]).unwrap_or_default().to_string())
}

/// An available transition: its id and the status it lands on.
pub struct Transition {
    pub id: String,
    pub to_id: String,
    pub to_name: String,
}

/// The transitions `listJiraIssueTransitions` offers from the issue's status:
/// REST's `{ transitions: [{ id, to: { id, name } }] }`, or a flat
/// `toStatusId`. A move picks the one landing on the target column's status.
pub fn transitions(v: &Value) -> Vec<Transition> {
    items(v, &["transitions", "values"])
        .iter()
        .filter_map(|t| {
            let to = t.get("to").or_else(|| t.get("toStatus"));
            Some(Transition {
                id: id_of(t.get("id"))?,
                to_id: id_of(to.and_then(|s| s.get("id")).or_else(|| t.get("toStatusId")))?,
                to_name: to
                    .and_then(|s| text(s, &["name"]))
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

/// Comments from `listJiraIssueComments` or `getJiraIssue`'s comment field,
/// oldest first.
pub fn comments(v: &Value) -> Vec<IssueComment> {
    let field = v.get("fields").and_then(|f| f.get("comment"));
    let list = match field {
        Some(f) => items(f, &["comments"]),
        None => items(v, &["comments", "values", "results"]),
    };
    let mut out: Vec<IssueComment> = list.iter().filter_map(rest::parse_comment).collect();
    if out.iter().all(|c| c.created.is_some()) {
        out.sort_by(|a, b| a.created.cmp(&b.created));
    }
    out
}

/// An issue's status category key, from `getJiraIssue`.
pub fn status_category(v: &Value) -> Option<String> {
    let status = v.get("fields")?.get("status")?;
    category(status.get("statusCategory"))
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod tests;
