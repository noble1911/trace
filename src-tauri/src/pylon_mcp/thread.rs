//! An issue's thread (customer messages and internal notes) from
//! `get_issue_messages`, normalised to REST's message shape and read by
//! `pylon::models`' own parser, so both adapters brief agents the same way.

use serde_json::{json, Map, Value};

use super::parse::{listed, str_at};
use crate::issues::models::IssueComment;
use crate::pylon::models::parse_comment;

/// A thread entry in REST's message shape (`message_html`, `author.name`,
/// `timestamp`, `is_private`). An entry that doesn't say whether it's private
/// counts as an internal note: an agent's brief then never presents a note as
/// something the customer said, which is the mistake that matters (a customer
/// message shown as internal only loses a label).
fn normalise_message(v: &Value) -> Value {
    let mut o: Map<String, Value> = v.as_object().cloned().unwrap_or_default();
    if !o.contains_key("message_html") {
        let body = str_at(v, &["body_html", "html", "body", "text", "content"]);
        o.insert("message_html".into(), json!(body.unwrap_or_default()));
    }
    let author = v.get("author").or_else(|| v.get("user"));
    let name = match author {
        Some(Value::String(s)) => Some(s.as_str()),
        Some(a) => str_at(a, &["name", "display_name", "email"]),
        None => str_at(v, &["author_name"]),
    };
    if let Some(name) = name {
        o.insert("author".into(), json!({ "name": name }));
    }
    if !o.contains_key("timestamp") {
        if let Some(t) = str_at(v, &["created_at", "sent_at"]) {
            o.insert("timestamp".into(), json!(t));
        }
    }
    if !o.contains_key("is_private") {
        let private = ["is_internal", "private", "internal"]
            .iter()
            .find_map(|k| v.get(*k).and_then(Value::as_bool));
        o.insert("is_private".into(), json!(private.unwrap_or(true)));
    }
    Value::Object(o)
}

/// A thread entry and when it was sent (for ordering).
pub type Dated = (Option<chrono::DateTime<chrono::Utc>>, IssueComment);

/// The thread entries in a `get_issue_messages` result. Err when it holds no
/// list of messages: a thread trace can't read mustn't read as an empty one.
pub fn messages(v: &Value) -> Result<Vec<Dated>, String> {
    Ok(listed(v, &["messages", "results"], "the thread")?
        .iter()
        .map(normalise_message)
        .filter_map(|m| {
            let c = parse_comment(&m)?;
            let at = c
                .created
                .as_deref()
                .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                .map(|t| t.with_timezone(&chrono::Utc));
            Some((at, c))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_entry_that_doesnt_say_is_an_internal_note() {
        let v = json!({ "messages": [
            { "body_html": "<p>Unsure</p>", "author": "Jo" },
            { "body_html": "<p>Public</p>", "author": "Al", "is_internal": false },
        ] });
        let thread = messages(&v).expect("thread");
        assert!(thread[0].1.is_internal, "unknown counts as internal");
        assert!(!thread[1].1.is_internal);
    }

    #[test]
    fn a_thread_that_isnt_a_list_is_an_error() {
        let err = messages(&json!({ "note": "nothing here" }))
            .err()
            .expect("refused");
        assert_eq!(
            err,
            "Pylon's MCP server sent the thread in a shape trace couldn't read."
        );
        assert!(messages(&json!({ "messages": [] }))
            .expect("empty")
            .is_empty());
    }
}
