//! Pull requests linked to an issue, from `getTeamworkGraphContext`.
//!
//! The tool's payload isn't documented (it returns "relationships and linked
//! objects" for an entity), so this doesn't assume a shape: it walks the JSON
//! for objects carrying a GitHub pull request URL and reads the usual fields
//! beside it. Anything it can't read is skipped; the PR badge is a nicety.

use serde_json::Value;

use crate::issues::models::PullRequest;

/// Nesting walked at most, against a pathological payload.
const MAX_DEPTH: usize = 12;

/// `…/pull/<n>` from a GitHub PR URL.
fn pr_number(url: &str) -> Option<String> {
    let (_, tail) = url.split_once("/pull/")?;
    let number: String = tail.chars().take_while(char::is_ascii_digit).collect();
    (!number.is_empty() && url.contains("github")).then_some(number)
}

fn field<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

/// `open` | `merged` | `declined` | `draft`, as the REST adapter's dev-status gives.
fn state_of(v: &Value) -> String {
    let raw = field(v, &["status", "state", "prStatus"])
        .unwrap_or("open")
        .to_ascii_lowercase();
    match raw.as_str() {
        "merged" => "merged",
        "declined" | "closed" | "rejected" => "declined",
        "draft" => "draft",
        _ => "open",
    }
    .to_string()
}

fn walk(v: &Value, depth: usize, out: &mut Vec<PullRequest>) {
    if depth > MAX_DEPTH {
        return;
    }
    match v {
        Value::Array(items) => items.iter().for_each(|i| walk(i, depth + 1, out)),
        Value::Object(map) => {
            let url = field(v, &["url", "webUrl", "href"]);
            if let Some((url, number)) = url.and_then(|u| pr_number(u).map(|n| (u, n))) {
                if !out.iter().any(|p| p.url == url) {
                    out.push(PullRequest {
                        number,
                        url: url.to_string(),
                        state: state_of(v),
                        title: field(v, &["title", "name", "displayName"])
                            .unwrap_or_default()
                            .to_string(),
                    });
                }
            }
            map.values().for_each(|child| walk(child, depth + 1, out));
        }
        _ => {}
    }
}

/// Every GitHub pull request in the payload, once each.
pub fn pull_requests(v: &Value) -> Vec<PullRequest> {
    let mut out = Vec::new();
    walk(v, 0, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_pull_requests_wherever_they_sit() {
        let v = json!({ "relationships": [
            { "type": "pull-request", "object": {
                "url": "https://github.com/acme/app/pull/42", "title": "Fix it", "status": "MERGED" } },
            { "type": "commit", "object": { "url": "https://github.com/acme/app/commit/abc" } },
            { "type": "pull-request", "object": {
                "url": "https://github.com/acme/app/pull/42", "title": "Fix it" } },
        ]});
        let prs = pull_requests(&v);
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].number, "42");
        assert_eq!(prs[0].state, "merged");
        assert_eq!(prs[0].title, "Fix it");
    }

    #[test]
    fn nothing_linked_is_empty() {
        assert!(pull_requests(&json!({ "relationships": [] })).is_empty());
    }
}
