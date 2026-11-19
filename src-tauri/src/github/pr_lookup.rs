//! Many PRs' list facts (state, title, branch, author) in one `gh api graphql`
//! call per repo, for the Pull requests page.
//!
//! The PRs an agent raised are known by URL (its conversation's `pr-link`
//! records), and they can be in any repo: an agent working in one repo often
//! raises its frontend half in another. Looking each up with `gh pr view` would
//! be a call per PR; a `gh pr list` per repo only reaches its newest few hundred.
//! One aliased query per repo names exactly the PRs wanted.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;
use serde_json::Value;

use super::links::parse_pr_url;

/// A PR as the Pull requests page lists it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrSummary {
    /// The URL it was asked for by (so callers can key on what they hold).
    pub url: String,
    pub number: u64,
    /// "open" | "draft" | "merged" | "closed".
    pub state: String,
    pub title: String,
    /// Its head branch.
    pub branch: String,
    /// Who opened it; `None` for a deleted account.
    pub author: Option<String>,
}

/// PRs per query: well inside GitHub's per-query node limits.
const CHUNK: usize = 50;

const FIELDS: &str = "number title state isDraft headRefName author { login }";

/// Every PR in `urls` that GitHub answered for, keyed by the URL given. A PR
/// GitHub can't resolve (deleted, transferred) is left out and the rest of its
/// query still counts; a repo no signed-in account can see leaves out its PRs.
pub fn lookup(urls: &[String]) -> HashMap<String, PrSummary> {
    let mut by_repo: BTreeMap<(String, String), BTreeMap<u64, String>> = BTreeMap::new();
    for url in urls {
        if let Some((owner, name, number)) = parse_pr_url(url) {
            by_repo
                .entry((owner, name))
                .or_default()
                .entry(number)
                .or_insert_with(|| url.clone());
        }
    }
    let mut out = HashMap::new();
    // `gh` needs somewhere to run; the query names the repo, so anywhere will do.
    let Some(home) = dirs::home_dir() else {
        return out;
    };
    let home = home.to_string_lossy();
    for ((owner, name), wanted) in by_repo {
        let numbers: Vec<u64> = wanted.keys().copied().collect();
        for chunk in numbers.chunks(CHUNK) {
            let args = vec![
                "api".to_string(),
                "graphql".to_string(),
                "-f".to_string(),
                format!("query={}", query(&owner, &name, chunk)),
            ];
            // One unresolvable PR fails the exit but not the others' answers.
            let Ok(stdout) = super::gh::run_partial(&home, &owner, &args) else {
                continue;
            };
            let Ok(json) = serde_json::from_slice::<Value>(&stdout) else {
                continue;
            };
            for mut pr in parse(&json) {
                if let Some(url) = wanted.get(&pr.number) {
                    pr.url = url.clone();
                    out.insert(url.clone(), pr);
                }
            }
        }
    }
    out
}

/// One query for `numbers` in `owner/name`, each PR aliased by its number.
/// Interpolating is safe: `parse_pr_url` only admits `[A-Za-z0-9._-]` names.
fn query(owner: &str, name: &str, numbers: &[u64]) -> String {
    let prs: Vec<String> = numbers
        .iter()
        .map(|n| format!("p{n}: pullRequest(number: {n}) {{ {FIELDS} }}"))
        .collect();
    format!(
        "query {{ repository(owner: \"{owner}\", name: \"{name}\") {{ {} }} }}",
        prs.join(" ")
    )
}

/// The PRs in a query's answer (`url` left blank: the caller knows it).
fn parse(json: &Value) -> Vec<PrSummary> {
    json.pointer("/data/repository")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|repo| repo.values())
        .filter_map(one)
        .collect()
}

fn one(pr: &Value) -> Option<PrSummary> {
    let draft = pr.get("isDraft").and_then(Value::as_bool).unwrap_or(false);
    let state = match (pr.get("state").and_then(Value::as_str), draft) {
        (Some("MERGED"), _) => "merged",
        (Some("CLOSED"), _) => "closed",
        (_, true) => "draft",
        _ => "open",
    };
    let text = |key: &str| {
        pr.get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    Some(PrSummary {
        url: String::new(),
        number: pr.get("number").and_then(Value::as_u64)?,
        state: state.to_string(),
        title: text("title"),
        branch: text("headRefName"),
        author: pr
            .pointer("/author/login")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse, query};
    use serde_json::json;

    #[test]
    fn asks_for_each_pr_by_an_alias() {
        let q = query("acme", "web.app", &[12, 3]);
        assert!(q.starts_with("query { repository(owner: \"acme\", name: \"web.app\")"));
        assert!(q.contains("p12: pullRequest(number: 12)"));
        assert!(q.contains("p3: pullRequest(number: 3)"));
    }

    #[test]
    fn reads_a_partial_answer_beside_its_errors() {
        // What `gh` prints (exiting 1) when one PR of the query can't be resolved.
        let answer = json!({
            "data": { "repository": {
                "p2221": { "number": 2221, "title": "Share models", "state": "OPEN",
                           "isDraft": false, "headRefName": "PM-5031", "author": null },
                "p999999": null
            } },
            "errors": [{ "type": "NOT_FOUND", "path": ["repository", "p999999"] }]
        });
        let prs = parse(&answer);
        assert_eq!(prs.len(), 1);
        assert_eq!((prs[0].number, prs[0].state.as_str()), (2221, "open"));
    }

    #[test]
    fn reads_each_state_and_skips_missing_prs() {
        let answer = json!({ "data": { "repository": {
            "p1": { "number": 1, "title": "One", "state": "OPEN", "isDraft": true,
                    "headRefName": "a", "author": { "login": "ron" } },
            "p2": { "number": 2, "title": "Two", "state": "MERGED", "isDraft": false,
                    "headRefName": "b", "author": null },
            "p3": null
        } } });
        let mut prs = parse(&answer);
        prs.sort_by_key(|p| p.number);
        let got: Vec<_> = prs
            .iter()
            .map(|p| {
                (
                    p.number,
                    p.state.as_str(),
                    p.branch.as_str(),
                    p.author.clone(),
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                (1, "draft", "a", Some("ron".to_string())),
                (2, "merged", "b", None)
            ]
        );
    }
}
