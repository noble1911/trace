//! Parsers from Jira's raw JSON into the provider-agnostic board models.
//!
//! We parse from `serde_json::Value` rather than deriving full Deserialize structs
//! because Jira payloads are large and version-variable — we pluck only what the
//! board needs and stay resilient to extra/missing fields.

use serde_json::Value;

use crate::issues::models::{initial_of, Assignee, Issue, IssueUser};

pub fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut cur = v;
    for key in path {
        cur = cur.get(key)?;
    }
    cur.as_str()
}

/// Map a Jira priority name to the design's p0..p3 accent code.
fn map_priority(name: &str) -> String {
    match name.to_ascii_lowercase().as_str() {
        "highest" | "blocker" | "critical" => "p0",
        "high" | "major" => "p1",
        "medium" => "p2",
        _ => "p3",
    }
    .to_string()
}

/// Flatten an Atlassian Document Format (ADF) node tree to plain text.
pub fn adf_to_text(node: &Value) -> String {
    fn walk(node: &Value, out: &mut String) {
        match node.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(t) = node.get("text").and_then(Value::as_str) {
                    out.push_str(t);
                }
            }
            Some("hardBreak") => out.push('\n'),
            _ => {}
        }
        if let Some(content) = node.get("content").and_then(Value::as_array) {
            for child in content {
                walk(child, out);
            }
            // Block-level nodes end with a newline so paragraphs separate.
            if matches!(
                node.get("type").and_then(Value::as_str),
                Some("paragraph") | Some("heading") | Some("listItem") | Some("blockquote")
            ) {
                out.push('\n');
            }
        }
    }
    let mut out = String::new();
    walk(node, &mut out);
    out.trim().to_string()
}

pub fn parse_user(v: &Value) -> IssueUser {
    IssueUser {
        account_id: str_at(v, &["accountId"]).unwrap_or("").to_string(),
        display_name: str_at(v, &["displayName"]).unwrap_or("Unknown").to_string(),
        email: str_at(v, &["emailAddress"]).map(str::to_string),
        avatar_url: str_at(v, &["avatarUrls", "48x48"]).map(str::to_string),
    }
}

fn parse_assignee(v: &Value) -> Option<Assignee> {
    let assignee = v.get("fields")?.get("assignee")?;
    if assignee.is_null() {
        return None;
    }
    let display_name = str_at(assignee, &["displayName"]).unwrap_or("Unknown").to_string();
    Some(Assignee {
        account_id: str_at(assignee, &["accountId"]).unwrap_or("").to_string(),
        initial: initial_of(&display_name),
        avatar_url: str_at(assignee, &["avatarUrls", "48x48"]).map(str::to_string),
        display_name,
    })
}

/// Convert one raw issue Value into the board's card shape.
pub fn parse_issue(v: &Value) -> Option<Issue> {
    let id = v.get("id")?.as_str()?.to_string();
    let key = v.get("key")?.as_str()?.to_string();
    let fields = v.get("fields")?;

    let labels = fields
        .get("labels")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();

    let description = fields
        .get("description")
        .filter(|d| !d.is_null())
        .map(adf_to_text)
        .filter(|s| !s.is_empty());

    let priority_name = str_at(fields, &["priority", "name"]).unwrap_or("Medium");
    let (epic_name, epic_key, epic_color) = parse_epic(fields);

    Some(Issue {
        id,
        key,
        summary: str_at(fields, &["summary"]).unwrap_or("(no summary)").to_string(),
        status_id: str_at(fields, &["status", "id"]).unwrap_or("").to_string(),
        status_name: str_at(fields, &["status", "name"]).unwrap_or("").to_string(),
        status_category: str_at(fields, &["status", "statusCategory", "key"])
            .unwrap_or("new")
            .to_string(),
        priority: map_priority(priority_name),
        issue_type: str_at(fields, &["issuetype", "name"]).unwrap_or("Task").to_string(),
        labels,
        assignee: parse_assignee(v),
        description,
        epic: epic_name,
        epic_key,
        epic_color,
        reporter: str_at(fields, &["reporter", "displayName"]).map(str::to_string),
        browse_url: None,
    })
}

/// Resolve the issue's epic. Company-managed projects expose an `epic` field;
/// team-managed ones expose the epic as `parent` (only when the parent is itself
/// an Epic — a sub-task's parent is a story, which we ignore). Returns
/// `(name, key, color)` — color is Jira's opaque palette key ("color_1"…
/// "color_14"), only present on the `epic` field, never on `parent`.
fn parse_epic(fields: &Value) -> (Option<String>, Option<String>, Option<String>) {
    if let Some(epic) = fields.get("epic").filter(|e| !e.is_null()) {
        let key = epic.get("key").and_then(Value::as_str).map(str::to_string);
        let name = epic
            .get("name")
            .or_else(|| epic.get("summary"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let color = epic
            .get("color")
            .and_then(|c| c.get("key"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if key.is_some() || name.is_some() {
            return (name, key, color);
        }
    }
    if let Some(parent) = fields.get("parent").filter(|p| !p.is_null()) {
        let is_epic = parent
            .get("fields")
            .and_then(|f| f.get("issuetype"))
            .and_then(|t| t.get("name"))
            .and_then(Value::as_str)
            .is_some_and(|n| n.eq_ignore_ascii_case("epic"));
        if is_epic {
            let key = parent.get("key").and_then(Value::as_str).map(str::to_string);
            let name = parent
                .get("fields")
                .and_then(|f| f.get("summary"))
                .and_then(Value::as_str)
                .map(str::to_string);
            return (name, key, None);
        }
    }
    (None, None, None)
}
