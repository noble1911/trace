//! Frontend-facing Jira shapes + parsers from Jira's raw JSON.
//!
//! We parse from `serde_json::Value` rather than deriving full Deserialize structs
//! because Jira payloads are large and version-variable — we pluck only what the
//! board needs and stay resilient to extra/missing fields.

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JiraUser {
    pub account_id: String,
    pub display_name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardSummary {
    pub id: i64,
    pub name: String,
    pub board_type: String,
}

/// A board column and the set of status ids that map into it. Order is the
/// board's configured order — this replaces any hardcoded column list.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    pub name: String,
    pub status_ids: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Assignee {
    pub account_id: String,
    pub display_name: String,
    pub initial: String,
    pub avatar_url: Option<String>,
}

/// A board card = a Jira issue from the current sprint.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub key: String,
    pub summary: String,
    pub status_id: String,
    pub status_name: String,
    /// Jira status category key: `new` | `indeterminate` | `done`.
    pub status_category: String,
    /// Mapped priority code for the card's accent bar: p0..p3.
    pub priority: String,
    pub issue_type: String,
    pub labels: Vec<String>,
    pub assignee: Option<Assignee>,
    pub description: Option<String>,
    pub epic: Option<String>,
    pub reporter: Option<String>,
}

/// Everything the board needs in one payload.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BoardData {
    pub board_id: i64,
    pub board_name: String,
    pub sprint_name: Option<String>,
    pub columns: Vec<BoardColumn>,
    pub issues: Vec<Issue>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub id: String,
    pub name: String,
    pub to_status_id: String,
    pub to_status_name: String,
}

// ---- parsers ---------------------------------------------------------------

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
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

fn initial_of(name: &str) -> String {
    name.chars()
        .next()
        .map(|c| c.to_ascii_uppercase().to_string())
        .unwrap_or_else(|| "?".to_string())
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

pub fn parse_user(v: &Value) -> JiraUser {
    JiraUser {
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

    Some(Issue {
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
        epic: str_at(fields, &["epic", "name"]).map(str::to_string),
        reporter: str_at(fields, &["reporter", "displayName"]).map(str::to_string),
    })
}
