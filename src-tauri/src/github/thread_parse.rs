//! GraphQL JSON → `PrThread`. Defensive: a missing field degrades to a default
//! rather than failing the whole PR.

use serde_json::Value;

use super::thread::{PrComment, PrEntry, PrThread};

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

fn nodes<'a>(v: &'a Value, key: &str) -> impl Iterator<Item = &'a Value> {
    v.get(key)
        .and_then(|c| c.get("nodes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

/// `(login, is_bot)`; a deleted account has a null author.
fn author(v: &Value) -> (String, bool) {
    match v.get("author") {
        Some(a) if a.is_object() => {
            let login = s(a, "login");
            let is_bot = s(a, "__typename") == "Bot" || login.ends_with("[bot]");
            (
                if login.is_empty() {
                    "ghost".into()
                } else {
                    login
                },
                is_bot,
            )
        }
        _ => ("ghost".into(), false),
    }
}

fn comment(v: &Value) -> PrComment {
    let (author, is_bot) = author(v);
    PrComment {
        id: s(v, "id"),
        author,
        is_bot,
        body: s(v, "body"),
        url: s(v, "url"),
        created_at: s(v, "createdAt"),
        edited_at: v
            .get("lastEditedAt")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

/// Newest of a comment's created/edited times. RFC3339 in UTC sorts as text.
fn latest(c: &PrComment) -> String {
    match &c.edited_at {
        Some(e) if *e > c.created_at => e.clone(),
        _ => c.created_at.clone(),
    }
}

fn entry(kind: &str, head: PrComment) -> PrEntry {
    PrEntry {
        kind: kind.into(),
        activity_at: latest(&head),
        head,
        review_state: None,
        path: None,
        line: None,
        resolved: false,
        outdated: false,
        replies: Vec::new(),
    }
}

fn checks_rollup(pr: &Value) -> Option<String> {
    let state = nodes(pr, "commits")
        .last()?
        .get("commit")?
        .get("statusCheckRollup")?
        .get("state")?
        .as_str()?;
    Some(
        match state {
            "SUCCESS" => "ok",
            "FAILURE" | "ERROR" => "fail",
            _ => "pending",
        }
        .into(),
    )
}

pub(super) fn parse(root: &Value) -> Option<PrThread> {
    let pr = root.get("data")?.get("repository")?.get("pullRequest")?;
    if !pr.is_object() {
        return None;
    }
    let mut entries: Vec<PrEntry> = Vec::new();

    // Minimized comments are ones someone hid as outdated/spam — hidden here too.
    for c in nodes(pr, "comments") {
        if c.get("isMinimized").and_then(Value::as_bool) != Some(true) {
            entries.push(entry("comment", comment(c)));
        }
    }

    for r in nodes(pr, "reviews") {
        let state = match s(r, "state").as_str() {
            "APPROVED" => "approved",
            "CHANGES_REQUESTED" => "changes",
            "DISMISSED" => "dismissed",
            "PENDING" => continue, // the viewer's own unsubmitted draft
            _ => "commented",
        };
        let head = comment(r);
        // A bodiless "commented" review is just the envelope of inline threads,
        // which appear on their own below.
        if state == "commented" && head.body.trim().is_empty() {
            continue;
        }
        let mut e = entry("review", head);
        e.review_state = Some(state.into());
        entries.push(e);
    }

    for t in nodes(pr, "reviewThreads") {
        let mut comments = nodes(t, "comments").map(comment);
        let Some(head) = comments.next() else {
            continue;
        };
        let mut e = entry("thread", head);
        e.replies = comments.collect();
        e.activity_at = e
            .replies
            .iter()
            .map(latest)
            .fold(e.activity_at, std::cmp::max);
        e.path = Some(s(t, "path")).filter(|p| !p.is_empty());
        e.line = t
            .get("line")
            .and_then(Value::as_u64)
            .or_else(|| t.get("originalLine").and_then(Value::as_u64));
        e.resolved = t
            .get("isResolved")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        e.outdated = t
            .get("isOutdated")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        entries.push(e);
    }
    entries.sort_by(|a, b| b.activity_at.cmp(&a.activity_at));

    let state = match (
        s(pr, "state").as_str(),
        pr.get("isDraft").and_then(Value::as_bool),
    ) {
        ("MERGED", _) => "merged",
        ("CLOSED", _) => "closed",
        (_, Some(true)) => "draft",
        _ => "open",
    };
    let review_decision = match s(pr, "reviewDecision").as_str() {
        "APPROVED" => Some("approved"),
        "CHANGES_REQUESTED" => Some("changes"),
        "REVIEW_REQUIRED" => Some("review"),
        _ => None,
    };
    Some(PrThread {
        url: s(pr, "url"),
        number: pr.get("number").and_then(Value::as_u64).unwrap_or(0),
        title: s(pr, "title"),
        state: state.into(),
        author: author(pr).0,
        head_ref: s(pr, "headRefName"),
        base_ref: s(pr, "baseRefName"),
        additions: pr.get("additions").and_then(Value::as_u64).unwrap_or(0),
        deletions: pr.get("deletions").and_then(Value::as_u64).unwrap_or(0),
        review_decision: review_decision.map(str::to_string),
        checks: checks_rollup(pr),
        check_runs: super::checks::parse(pr),
        updated_at: s(pr, "updatedAt"),
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::parse;
    use serde_json::json;

    fn c(
        id: &str,
        login: &str,
        kind: &str,
        created: &str,
        edited: Option<&str>,
    ) -> serde_json::Value {
        json!({ "id": id, "body": format!("body {id}"), "url": format!("u/{id}"),
                "createdAt": created, "lastEditedAt": edited,
                "author": { "login": login, "__typename": kind } })
    }

    #[test]
    fn builds_a_newest_first_conversation_from_comments_reviews_and_threads() {
        let mut hidden = c("hid", "x", "User", "2026-09-01T00:00:00Z", None);
        hidden["isMinimized"] = json!(true);
        let root = json!({ "data": { "repository": { "pullRequest": {
            "url": "https://github.com/a/b/pull/3", "number": 3, "title": "T",
            "state": "OPEN", "isDraft": false, "headRefName": "workspace/x", "baseRefName": "main",
            "additions": 5, "deletions": 1, "reviewDecision": "CHANGES_REQUESTED",
            "updatedAt": "2026-09-05T00:00:00Z", "author": { "login": "ron", "__typename": "User" },
            "commits": { "nodes": [{ "commit": { "statusCheckRollup": { "state": "FAILURE" } } }] },
            // A bot comment created first but edited last — it should lead.
            "comments": { "nodes": [
                c("bot", "codecov", "Bot", "2026-09-01T00:00:00Z", Some("2026-09-06T00:00:00Z")),
                c("hum", "alice", "User", "2026-09-02T00:00:00Z", None),
                hidden,
            ] },
            "reviews": { "nodes": [
                { "id": "env", "body": "", "state": "COMMENTED", "url": "",
                  "createdAt": "2026-09-03T00:00:00Z", "author": { "login": "bob" } },
                { "id": "rv", "body": "", "state": "CHANGES_REQUESTED", "url": "",
                  "createdAt": "2026-09-03T00:00:00Z", "author": { "login": "bob" } },
            ] },
            "reviewThreads": { "nodes": [{
                "isResolved": true, "isOutdated": false, "path": "src/a.rs", "line": null,
                "originalLine": 9,
                "comments": { "nodes": [
                    c("t1", "bob", "User", "2026-09-03T00:00:00Z", None),
                    c("t2", "ron", "User", "2026-09-04T00:00:00Z", None),
                ] } }] },
        } } } });
        let pr = parse(&root).expect("parses");
        assert_eq!(
            (pr.state.as_str(), pr.checks.as_deref()),
            ("open", Some("fail"))
        );
        assert_eq!(pr.review_decision.as_deref(), Some("changes"));
        let order: Vec<&str> = pr.entries.iter().map(|e| e.head.id.as_str()).collect();
        assert_eq!(order, vec!["bot", "t1", "rv", "hum"]);
        assert!(pr.entries[0].head.is_bot);
        let thread = &pr.entries[1];
        assert_eq!(
            (thread.path.as_deref(), thread.line),
            (Some("src/a.rs"), Some(9))
        );
        assert!(thread.resolved);
        assert_eq!(thread.replies.len(), 1);
        assert_eq!(thread.activity_at, "2026-09-04T00:00:00Z");
    }

    #[test]
    fn a_missing_pr_is_none() {
        assert!(parse(&json!({ "data": { "repository": { "pullRequest": null } } })).is_none());
    }
}
