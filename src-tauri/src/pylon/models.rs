//! Parsers from Pylon's raw JSON into the provider-agnostic board models.

use std::collections::HashMap;

use serde_json::Value;

use crate::issues::models::{initial_of, Assignee, Issue};

/// Pylon's base issue states, in board-column order. Custom status slugs are
/// appended before `closed` as they're discovered on issues.
pub const BASE_STATES: &[(&str, &str, &str)] = &[
    ("new", "New", "new"),
    ("waiting_on_you", "Waiting on You", "indeterminate"),
    ("waiting_on_customer", "Waiting on Customer", "indeterminate"),
    ("on_hold", "On Hold", "indeterminate"),
    ("closed", "Closed", "done"),
];

/// Display name for a state slug: the base label, or a title-cased custom slug
/// (`escalated_to_eng` → "Escalated to Eng").
pub fn state_name(slug: &str) -> String {
    if let Some((_, name, _)) = BASE_STATES.iter().find(|(s, _, _)| *s == slug) {
        return name.to_string();
    }
    let mut out = slug.replace(['_', '-'], " ");
    if let Some(first) = out.get(..1) {
        out.replace_range(..1, &first.to_uppercase());
    }
    out
}

/// Status category (`new` | `indeterminate` | `done`) for a state slug. Custom
/// slugs count as in-progress.
pub fn state_category(slug: &str) -> String {
    BASE_STATES
        .iter()
        .find(|(s, _, _)| *s == slug)
        .map(|(_, _, cat)| cat.to_string())
        .unwrap_or_else(|| "indeterminate".to_string())
}

/// Convert one raw Pylon issue Value into the board's card shape. `user_names`
/// maps user id → (display name, avatar) (assignees arrive as id-only).
pub fn parse_issue(v: &Value, user_names: &HashMap<String, (String, Option<String>)>) -> Option<Issue> {
    let id = v.get("id")?.as_str()?.to_string();
    let number = v.get("number").and_then(Value::as_i64).unwrap_or(0);
    let key = if number > 0 {
        format!("#{number}")
    } else {
        id.clone()
    };
    let state = v.get("state").and_then(Value::as_str).unwrap_or("new").to_string();

    let labels = v
        .get("tags")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();

    let description = v
        .get("body_html")
        .and_then(Value::as_str)
        .map(html_to_text)
        .filter(|s| !s.is_empty());

    Some(Issue {
        id,
        key,
        summary: v
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("(no title)")
            .to_string(),
        status_id: state.clone(),
        status_name: state_name(&state),
        status_category: state_category(&state),
        // Pylon issues carry no priority field — neutral accent.
        priority: "p3".to_string(),
        issue_type: "Support".to_string(),
        labels,
        assignee: parse_assignee(v, user_names),
        description,
        epic: None,
        epic_key: None,
        epic_color: None,
        reporter: v
            .get("requester")
            .and_then(|r| r.get("email"))
            .and_then(Value::as_str)
            .map(str::to_string),
        browse_url: v.get("link").and_then(Value::as_str).map(str::to_string),
    })
}

fn parse_assignee(v: &Value, user_names: &HashMap<String, (String, Option<String>)>) -> Option<Assignee> {
    let a = v.get("assignee")?;
    if a.is_null() {
        return None;
    }
    let id = a.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    let email = a.get("email").and_then(Value::as_str).unwrap_or("");
    let (display_name, avatar_url) = match user_names.get(&id) {
        Some((name, avatar)) => (name.clone(), avatar.clone()),
        None => (
            email
                .split('@')
                .next()
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| "Unknown".to_string()),
            None,
        ),
    };
    Some(Assignee {
        account_id: id,
        initial: initial_of(&display_name),
        avatar_url,
        display_name,
    })
}

/// Reduce Pylon's `body_html` to plain text for the Ticket tab. Deliberately
/// small: block-level tags become newlines, the rest is stripped, common
/// entities decoded.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for c in html.chars() {
        match c {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let t = tag.trim_start_matches('/').to_ascii_lowercase();
                if matches!(
                    t.as_str(),
                    "br" | "p" | "div" | "li" | "ul" | "ol" | "blockquote" | "h1" | "h2" | "h3" | "tr"
                ) {
                    out.push('\n');
                }
            }
            _ if in_tag => tag.push(c),
            '&' => out.push('&'),
            _ => out.push(c),
        }
    }
    out = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    // Collapse 3+ newlines and trim.
    while out.contains("\n\n\n") {
        out = out.replace("\n\n\n", "\n\n");
    }
    out.trim().to_string()
}
