//! A PR's individual checks — Claude review, unit tests, lint… — as the rail's
//! Checks section shows them. GitHub has two kinds: Actions/App `CheckRun`s
//! (status + conclusion + timings) and legacy commit `StatusContext`s (one
//! state); both normalise to one shape here.

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub name: String,
    /// The Actions workflow it belongs to, when there is one.
    pub workflow: Option<String>,
    /// "queued" | "running" | "passed" | "failed" | "cancelled" | "skipped" | "neutral".
    pub state: String,
    /// A status context's one-line description ("3 of 5 tasks", "Coverage 87%").
    pub detail: Option<String>,
    pub url: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

fn s(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|x| !x.is_empty())
        .map(str::to_string)
}

fn check_run(c: &Value) -> PrCheck {
    let state = match (s(c, "status").as_deref(), s(c, "conclusion").as_deref()) {
        (Some("COMPLETED"), Some("SUCCESS")) => "passed",
        (Some("COMPLETED"), Some("SKIPPED")) => "skipped",
        (Some("COMPLETED"), Some("NEUTRAL")) => "neutral",
        (Some("COMPLETED"), Some("CANCELLED")) => "cancelled",
        (Some("COMPLETED"), _) => "failed",
        (Some("IN_PROGRESS"), _) => "running",
        _ => "queued", // QUEUED | PENDING | WAITING | REQUESTED
    };
    PrCheck {
        name: s(c, "name").unwrap_or_else(|| "check".into()),
        workflow: c
            .pointer("/checkSuite/workflowRun/workflow/name")
            .and_then(Value::as_str)
            .map(str::to_string),
        state: state.into(),
        detail: None,
        url: s(c, "detailsUrl"),
        started_at: s(c, "startedAt"),
        completed_at: s(c, "completedAt"),
    }
}

fn status_context(c: &Value) -> PrCheck {
    let state = match s(c, "state").as_deref() {
        Some("SUCCESS") => "passed",
        Some("FAILURE") | Some("ERROR") => "failed",
        _ => "running", // PENDING / EXPECTED
    };
    PrCheck {
        name: s(c, "context").unwrap_or_else(|| "status".into()),
        workflow: None,
        state: state.into(),
        detail: s(c, "description"),
        url: s(c, "targetUrl"),
        started_at: s(c, "createdAt"),
        completed_at: None,
    }
}

/// What needs eyes first: failures, then work in flight, then the settled.
fn urgency(state: &str) -> u8 {
    match state {
        "failed" => 0,
        "running" => 1,
        "queued" => 2,
        "cancelled" => 3,
        "passed" => 4,
        _ => 5, // skipped, neutral
    }
}

/// One row per (workflow, name). A comment-triggered workflow (e.g. `claude`)
/// runs — and skips itself — on every PR comment, leaving a pile of identical
/// skipped runs; keep a run that actually did something over a skip, else the
/// latest.
fn dedupe(checks: Vec<PrCheck>) -> Vec<PrCheck> {
    let mut out: Vec<PrCheck> = Vec::new();
    for c in checks {
        let same = out
            .iter_mut()
            .find(|k| k.name == c.name && k.workflow == c.workflow);
        match same {
            None => out.push(c),
            Some(kept) => {
                let skip = |x: &PrCheck| x.state == "skipped";
                let better = (skip(kept) && !skip(&c))
                    || (skip(kept) == skip(&c) && c.started_at > kept.started_at);
                if better {
                    *kept = c;
                }
            }
        }
    }
    out
}

/// The head commit's checks from a `pullRequest` GraphQL node.
pub(super) fn parse(pr: &Value) -> Vec<PrCheck> {
    let all: Vec<PrCheck> = pr
        .pointer("/commits/nodes")
        .and_then(Value::as_array)
        .and_then(|nodes| nodes.last())
        .and_then(|n| n.pointer("/commit/statusCheckRollup/contexts/nodes"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|c| match c.get("__typename").and_then(Value::as_str) {
            Some("StatusContext") => status_context(c),
            _ => check_run(c),
        })
        .collect();
    let mut out = dedupe(all);
    out.sort_by(|a, b| {
        urgency(&a.state)
            .cmp(&urgency(&b.state))
            .then(a.name.cmp(&b.name))
    });
    out
}

#[cfg(test)]
mod tests {
    use super::parse;
    use serde_json::json;

    #[test]
    fn normalises_check_runs_and_statuses_most_urgent_first() {
        let pr = json!({ "commits": { "nodes": [{ "commit": { "statusCheckRollup": {
            "state": "PENDING",
            "contexts": { "nodes": [
                { "__typename": "CheckRun", "name": "unit-tests", "status": "COMPLETED",
                  "conclusion": "SUCCESS", "startedAt": "2026-09-24T10:00:00Z",
                  "completedAt": "2026-09-24T10:04:00Z",
                  "checkSuite": { "workflowRun": { "workflow": { "name": "Build and Test" } } } },
                { "__typename": "CheckRun", "name": "claude-review", "status": "IN_PROGRESS",
                  "conclusion": null, "startedAt": "2026-09-24T10:01:00Z" },
                { "__typename": "StatusContext", "context": "codecov", "state": "FAILURE",
                  "description": "Coverage dropped 2%", "targetUrl": "https://codecov.io/x" },
                { "__typename": "CheckRun", "name": "deploy", "status": "QUEUED" },
                // A comment-triggered workflow's skipped repeats collapse to one row.
                { "__typename": "CheckRun", "name": "claude", "status": "COMPLETED", "conclusion": "SKIPPED" },
                { "__typename": "CheckRun", "name": "claude", "status": "COMPLETED", "conclusion": "SKIPPED" },
            ] } } } }] } });
        let checks = parse(&pr);
        let shape: Vec<(&str, &str)> = checks
            .iter()
            .map(|c| (c.name.as_str(), c.state.as_str()))
            .collect();
        assert_eq!(
            shape,
            vec![
                ("codecov", "failed"),
                ("claude-review", "running"),
                ("deploy", "queued"),
                ("unit-tests", "passed"),
                ("claude", "skipped"),
            ]
        );
        assert_eq!(checks[3].workflow.as_deref(), Some("Build and Test"));
        assert_eq!(checks[0].detail.as_deref(), Some("Coverage dropped 2%"));
    }
}
