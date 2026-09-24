//! Every recent PR in a repo, keyed by head branch — one `gh pr list` that
//! answers "which PR is this branch's?" for a whole page of sessions at once,
//! instead of one `gh` call per session.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::Value;

/// A PR as a list row shows it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrRef {
    pub number: u64,
    /// "open" | "draft" | "merged" | "closed".
    pub state: String,
    pub url: String,
}

/// PRs updated most recently are the ones a live session could own.
const LIMIT: &str = "200";

/// head branch → its most relevant PR (an open one beats a finished one).
/// Empty when the repo isn't on GitHub or `gh` can't read it.
pub fn by_branch(cwd: &str) -> HashMap<String, PrRef> {
    let Some(owner) = std::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(cwd)
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|remote| super::links::remote_owner(remote.trim()))
    else {
        return HashMap::new();
    };
    let args: Vec<String> = [
        "pr",
        "list",
        "--state",
        "all",
        "--limit",
        LIMIT,
        "--json",
        "number,state,isDraft,url,headRefName",
    ]
    .iter()
    .map(|a| a.to_string())
    .collect();
    super::gh::run(cwd, &owner, &args)
        .ok()
        .and_then(|out| serde_json::from_slice::<Value>(&out).ok())
        .map(|v| parse(&v))
        .unwrap_or_default()
}

fn parse(list: &Value) -> HashMap<String, PrRef> {
    let mut out: HashMap<String, PrRef> = HashMap::new();
    for pr in list.as_array().into_iter().flatten() {
        let Some(branch) = pr.get("headRefName").and_then(Value::as_str) else {
            continue;
        };
        let draft = pr.get("isDraft").and_then(Value::as_bool).unwrap_or(false);
        let state = match (pr.get("state").and_then(Value::as_str), draft) {
            (Some("MERGED"), _) => "merged",
            (Some("CLOSED"), _) => "closed",
            (_, true) => "draft",
            _ => "open",
        };
        let candidate = PrRef {
            number: pr.get("number").and_then(Value::as_u64).unwrap_or(0),
            state: state.to_string(),
            url: pr
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        };
        let live = |p: &PrRef| p.state == "open" || p.state == "draft";
        // gh lists newest first: keep the first seen unless a later one is live
        // and the kept one isn't (a reopened branch after a closed attempt).
        match out.get(branch) {
            Some(kept) if live(kept) || !live(&candidate) => {}
            _ => {
                out.insert(branch.to_string(), candidate);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::parse;
    use serde_json::json;

    #[test]
    fn maps_branches_to_their_most_relevant_pr() {
        let list = json!([
            { "number": 9, "state": "CLOSED", "isDraft": false, "url": "u9", "headRefName": "workspace/a" },
            { "number": 7, "state": "OPEN", "isDraft": true, "url": "u7", "headRefName": "workspace/a" },
            { "number": 5, "state": "MERGED", "isDraft": false, "url": "u5", "headRefName": "workspace/b" },
            { "number": 3, "state": "OPEN", "isDraft": false, "url": "u3", "headRefName": "workspace/b" },
        ]);
        let map = parse(&list);
        assert_eq!(
            (map["workspace/a"].number, map["workspace/a"].state.as_str()),
            (7, "draft")
        );
        assert_eq!(
            (map["workspace/b"].number, map["workspace/b"].state.as_str()),
            (3, "open")
        );
    }
}
