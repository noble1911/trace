//! Reading Pylon's MCP results into the shared models, tolerantly.
//!
//! **Response shapes are guessed.** Pylon doesn't document what its MCP tools
//! return. They front its REST API, so each result is read as REST's shape
//! first (`{ data: [...], pagination: { cursor, has_next_page } }`, issues as
//! in `pylon::models`), with the likely variations beside it: the list under
//! a named key (`issues`, `messages`, …) or bare, paging keys at the top,
//! numbers as strings, a state as an object. Issues and messages are then
//! normalised to REST's shape and handed to `pylon::models`' own parsers, so
//! both adapters make the same cards.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::issues::models::IssueUser;
use crate::pylon::models::parse_issue;

/// id → (display name, avatar), for labelling assignees.
pub type UserNames = HashMap<String, (String, Option<String>)>;

pub(super) fn str_at<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|k| v.get(*k).and_then(Value::as_str))
        .filter(|s| !s.is_empty())
}

/// The list in a result: the result itself, under one of `keys`, or under
/// `data` (itself a list, or holding one of `keys`). Lenient (none found is
/// an empty list): for what's best effort.
pub fn list(v: &Value, keys: &[&str]) -> Vec<Value> {
    found_list(v, keys).unwrap_or_default()
}

fn found_list(v: &Value, keys: &[&str]) -> Option<Vec<Value>> {
    let under = |v: &Value| keys.iter().find_map(|k| v.get(*k)?.as_array().cloned());
    if let Some(a) = v.as_array() {
        return Some(a.clone());
    }
    if let Some(a) = under(v) {
        return Some(a);
    }
    match v.get("data")? {
        Value::Array(a) => Some(a.clone()),
        d => under(d),
    }
}

/// [`list`] for what the board is made of: Err when there's no list at all,
/// so a payload of another shape never reads as "no issues". `what` names the
/// items in the error.
pub fn listed(v: &Value, keys: &[&str], what: &str) -> Result<Vec<Value>, String> {
    found_list(v, keys)
        .ok_or_else(|| format!("Pylon's MCP server sent {what} in a shape trace couldn't read."))
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
        "Pylon's MCP server answered {tool} with something trace couldn't read: {said}"
    ))
}

/// A result's next cursor, when there's another page.
pub fn next_cursor(v: &Value) -> Option<String> {
    let p = v
        .get("pagination")
        .or_else(|| v.get("data").and_then(|d| d.get("pagination")))
        .unwrap_or(v);
    let cursor = str_at(p, &["cursor", "next_cursor", "nextCursor"])?.to_string();
    let more = p
        .get("has_next_page")
        .or_else(|| p.get("hasNextPage"))
        .and_then(Value::as_bool);
    // No flag but a cursor: assume there's more (an empty page ends it anyway).
    more.unwrap_or(true).then_some(cursor)
}

/// An issue in REST's shape: `id` and `number` as REST types them, `state` a
/// slug, the body under `body_html`.
pub fn normalise_issue(v: &Value) -> Value {
    let mut o: Map<String, Value> = v.as_object().cloned().unwrap_or_default();
    if let Some(Value::Number(n)) = o.get("id") {
        let id = n.to_string();
        o.insert("id".into(), json!(id));
    }
    if let Some(Value::String(s)) = o.get("number") {
        if let Ok(n) = s.trim_start_matches('#').parse::<i64>() {
            o.insert("number".into(), json!(n));
        }
    }
    let state = match o.get("state").or_else(|| o.get("status")) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(obj @ Value::Object(_)) => {
            str_at(obj, &["slug", "state", "value"]).map(str::to_string)
        }
        _ => None,
    };
    if let Some(s) = state {
        o.insert("state".into(), json!(s));
    }
    if !o.contains_key("body_html") {
        if let Some(b) = str_at(v, &["body", "description"]) {
            o.insert("body_html".into(), json!(b));
        }
    }
    if !o.contains_key("id") {
        if let Some(n) = o.get("number").cloned() {
            o.insert("id".into(), json!(n.to_string()));
        }
    }
    Value::Object(o)
}

/// A card from one issue, as the REST adapter makes it.
pub fn issue(v: &Value, names: &UserNames) -> Option<crate::issues::models::Issue> {
    parse_issue(&normalise_issue(v), names)
}

/// An issue's state slug.
pub fn state_of(v: &Value) -> Option<String> {
    let issue = v.get("data").filter(|d| d.is_object()).unwrap_or(v);
    let issue = issue.get("issue").unwrap_or(issue);
    normalise_issue(issue)
        .get("state")
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// When an issue was created, for the rolling window.
pub fn created(v: &Value) -> Option<chrono::DateTime<chrono::Utc>> {
    let s = str_at(v, &["created_at", "createdAt"])?;
    let t = chrono::DateTime::parse_from_rfc3339(s).ok()?;
    Some(t.with_timezone(&chrono::Utc))
}

/// Names the issues carry on their assignees (REST gives id and email only;
/// the MCP payload may add a name).
pub fn names_on(issues: &[Value]) -> UserNames {
    let assignees = issues.iter().filter_map(|i| i.get("assignee"));
    users_from(assignees)
}

fn users_from<'a>(users: impl Iterator<Item = &'a Value>) -> UserNames {
    let mut out = UserNames::new();
    for u in users {
        let Some(id) = u.get("id").and_then(Value::as_str) else {
            continue;
        };
        if let Some(name) = str_at(u, &["name", "display_name", "full_name"]) {
            let avatar = str_at(u, &["avatar_url", "avatarUrl"]).map(str::to_string);
            out.insert(id.to_string(), (name.to_string(), avatar));
        }
    }
    out
}

/// Every user in a `search_users` result.
pub fn users(v: &Value) -> UserNames {
    users_from(list(v, &["users", "results"]).iter())
}

/// The signed-in user from `get_me`: the user itself, or REST's org-centric
/// `{ data: { name (org), user: { id, email } } }`. Err without an id:
/// connecting validates the login with this, and a placeholder would let a
/// broken login through.
pub fn me(v: &Value) -> Result<IssueUser, String> {
    let data = v.get("data").unwrap_or(v);
    let user = data.get("user").unwrap_or(data);
    let email = str_at(user, &["email"]).map(str::to_string);
    let local = email.as_deref().and_then(|e| e.split('@').next());
    let display_name = str_at(user, &["name", "display_name"])
        .or(local)
        .or_else(|| str_at(data, &["name"]))
        .unwrap_or("Pylon")
        .to_string();
    let Some(id) = str_at(user, &["id", "user_id"]) else {
        return Err("Pylon's MCP server didn't say who trace is signed in as.".to_string());
    };
    Ok(IssueUser {
        account_id: id.to_string(),
        display_name,
        email,
        avatar_url: str_at(user, &["avatar_url"]).map(str::to_string),
    })
}

/// One of the organisation's statuses.
#[derive(Clone, Debug, PartialEq)]
pub struct Status {
    pub slug: String,
    pub label: Option<String>,
}

/// The live statuses in a `get_issue_statuses` result (REST's `IssueStatus`:
/// `slug`, `label`, `category`, `is_archived`), archived ones left out.
pub fn statuses(v: &Value) -> Vec<Status> {
    list(v, &["statuses", "issue_statuses", "results"])
        .iter()
        .filter(|s| {
            !s.get("is_archived")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .filter_map(|s| {
            Some(Status {
                slug: str_at(s, &["slug", "state", "value"])?.to_string(),
                label: str_at(s, &["label", "name"]).map(str::to_string),
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "parse_tests.rs"]
mod tests;
