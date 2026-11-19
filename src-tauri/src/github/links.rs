//! Discovering a workspace's pull requests.
//!
//! Two sources, because neither is complete on its own:
//! - **The worktree's branch.** `gh pr list --head <branch>` finds a PR however
//!   it was raised — but misses one an agent opened from a branch it created.
//! - **The conversation.** Claude's JSONL log (`claude::conversations`) records
//!   each PR the agent created, long after the TUI repainted it away. Only
//!   creations count: a log is full of PR links the agent merely *saw* (a doc
//!   it read, `gh pr list`, a URL it was handed), and those aren't its PRs.
//!   Codex keeps no such log; the branch still works.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

use crate::repo_catalog::model::RemoteRepo;

/// Most PRs surfaced per workspace — an agent that raises a stack of PRs
/// shouldn't turn the tab into a list of them.
const MAX_PRS: usize = 6;

fn pr_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Owner/repo per GitHub's allowed characters; anything after the number
        // (`/files`, `#issuecomment-…`) is dropped so variants dedupe.
        Regex::new(r"https://github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)/pull/(\d+)")
            .expect("static regex")
    })
}

/// A PR URL's parts: `(owner, repo, number)`. `None` if it isn't one.
pub fn parse_pr_url(url: &str) -> Option<(String, String, u64)> {
    let caps = pr_url_re().captures(url)?;
    let number = caps[3].parse().ok()?;
    Some((caps[1].to_string(), caps[2].to_string(), number))
}

/// Canonical PR URLs mentioned in `text`, most recently mentioned first.
pub fn urls_in(text: &str) -> Vec<String> {
    // (url, position of its last mention)
    let mut seen: Vec<(String, usize)> = Vec::new();
    for caps in pr_url_re().captures_iter(text) {
        let url = format!(
            "https://github.com/{}/{}/pull/{}",
            &caps[1], &caps[2], &caps[3]
        );
        let at = caps.get(0).map_or(0, |m| m.start());
        match seen.iter_mut().find(|(u, _)| *u == url) {
            Some(entry) => entry.1 = at,
            None => seen.push((url, at)),
        }
    }
    seen.sort_by(|a, b| b.1.cmp(&a.1));
    seen.into_iter().map(|(u, _)| u).collect()
}

/// PRs a Claude conversation created, newest first: the ones Claude Code itself
/// linked to it (a `pr-link` record, written when a `gh pr create` in the
/// conversation prints a PR). Every other URL in the log is a mention, not this
/// conversation's PR.
pub fn created_in(log: &str) -> Vec<String> {
    created_in_dated(log)
        .into_iter()
        .map(|(url, _)| url)
        .collect()
}

/// [`created_in`] with each PR's latest `pr-link` time (ISO 8601, so it sorts as
/// text; empty when the record has none), for ordering PRs across several logs.
pub fn created_in_dated(log: &str) -> Vec<(String, String)> {
    let mut seen = HashSet::new();
    let mut found: Vec<(String, String)> = log
        .lines()
        // Logs run to megabytes: only parse the lines that can be a record.
        .filter(|line| line.contains("\"pr-link\""))
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["type"] == "pr-link")
        .filter_map(|entry| {
            let url = entry["prUrl"].as_str().and_then(|u| urls_in(u).pop())?;
            let at = entry["timestamp"].as_str().unwrap_or("").to_string();
            Some((url, at))
        })
        .collect();
    found.reverse();
    found.retain(|(u, _)| seen.insert(u.clone()));
    found
}

/// PRs for a workspace running in `cwd` whose Claude conversations are
/// `conversation_ids`: the branch's own PRs first (unambiguously this
/// workspace's), then the ones its conversations created, newest first.
pub fn discover(cwd: &str, conversation_ids: &[String]) -> Vec<String> {
    let mut out = branch_prs(cwd);
    for id in conversation_ids {
        let Some(path) = crate::claude::conversations::conversation_path(cwd, id) else {
            continue;
        };
        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        for url in created_in(&raw) {
            if !out.contains(&url) {
                out.push(url);
            }
        }
    }
    out.truncate(MAX_PRS);
    out
}

/// PRs whose head is the worktree's current branch. Empty on the default
/// branch (a legacy session running in the repo root) — "every PR ever merged
/// from main" isn't this workspace's.
fn branch_prs(cwd: &str) -> Vec<String> {
    let Some(branch) = git_stdout(cwd, "git", &["rev-parse", "--abbrev-ref", "HEAD"]) else {
        return Vec::new();
    };
    if branch == "HEAD" || branch == crate::git::get_default_branch(cwd) {
        return Vec::new();
    }
    // The owner keys which signed-in account `gh::run` uses; a non-GitHub
    // remote has no PRs to find.
    let Some(owner) = git_stdout(cwd, "git", &["remote", "get-url", "origin"])
        .and_then(|remote| remote_owner(&remote))
    else {
        return Vec::new();
    };
    head_prs(cwd, &owner, &head_pr_args(&branch, None))
}

/// PRs whose head is `branch` on GitHub's `owner/name`, with no checkout to
/// ask: a session in a cloud sandbox pushes its branch there, and its
/// conversation log stays in the sandbox, so the branch is the one source.
pub fn repo_branch_prs(remote: &RemoteRepo, branch: &str) -> Vec<String> {
    // `gh` needs somewhere to run; `--repo` says which repo, so anywhere will do.
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let args = head_pr_args(branch, Some(&remote.full_name()));
    head_prs(&home.to_string_lossy(), &remote.owner, &args)
}

/// `gh pr list` for a head branch, in the checkout's repo or `repo`'s.
fn head_pr_args(branch: &str, repo: Option<&str>) -> Vec<String> {
    let limit = MAX_PRS.to_string();
    let mut args: Vec<&str> = vec![
        "pr", "list", "--head", branch, "--state", "all", "--limit", &limit, "--json", "url",
        "--jq", ".[].url",
    ];
    if let Some(repo) = repo {
        args.extend(["--repo", repo]);
    }
    args.into_iter().map(str::to_string).collect()
}

/// The PR URLs `gh args` lists, as whichever account can see `owner`'s repo.
fn head_prs(cwd: &str, owner: &str, args: &[String]) -> Vec<String> {
    super::gh::run(cwd, owner, args)
        .map(|out| {
            String::from_utf8_lossy(&out)
                .lines()
                .filter(|l| parse_pr_url(l).is_some())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// The owner in a GitHub remote — `git@github.com:acme/web.git`, an ssh host
/// alias like `git@github.com-work:acme/web.git`, or `https://github.com/acme/web`.
pub(super) fn remote_owner(remote: &str) -> Option<String> {
    let rest = remote.split_once("github.com")?.1;
    // Skip an ssh alias suffix (`-work`) up to the `:` or `/` before the owner.
    let rest = &rest[rest.find([':', '/'])? + 1..];
    let owner = rest.split('/').next()?.trim();
    (!owner.is_empty()).then(|| owner.to_string())
}

/// Trimmed stdout of a successful `tool args` run in `cwd`.
fn git_stdout(cwd: &str, tool: &str, args: &[&str]) -> Option<String> {
    let out = crate::claude::discovery::command(tool)
        .args(args)
        .current_dir(cwd)
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{created_in, head_pr_args, parse_pr_url, remote_owner, urls_in};

    #[test]
    fn lists_a_head_branch_here_or_in_a_named_repo() {
        let here = head_pr_args("workspace/x", None);
        assert_eq!(here[..4], ["pr", "list", "--head", "workspace/x"]);
        assert!(!here.contains(&"--repo".to_string()));
        let there = head_pr_args("workspace/x", Some("acme/web"));
        assert_eq!(there[there.len() - 2..], ["--repo", "acme/web"]);
    }

    #[test]
    fn counts_only_the_prs_a_conversation_created() {
        let log = [
            // A doc the agent read links shipped PRs: mentions, not its own.
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"read1","content":"shipped ([#11](https://github.com/acme/web/pull/11))"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Like https://github.com/acme/web/pull/13"}]}}"#,
            // Output that quotes a record isn't one.
            r#"{"type":"user","message":{"content":[{"type":"tool_result","content":"{\"type\":\"pr-link\",\"prUrl\":\"https://github.com/acme/web/pull/14\"}"}]}}"#,
            // Claude Code's own records of the PRs it raised (one repeated).
            r#"{"type":"pr-link","prNumber":20,"prUrl":"https://github.com/acme/web/pull/20"}"#,
            r#"{"type":"pr-link","prNumber":21,"prUrl":"https://github.com/acme/web/pull/21"}"#,
            r#"{"type":"pr-link","prNumber":20,"prUrl":"https://github.com/acme/web/pull/20"}"#,
            r#"not json "pr-link" https://github.com/acme/web/pull/99"#,
        ]
        .join("\n");
        assert_eq!(
            created_in(&log),
            vec![
                "https://github.com/acme/web/pull/20",
                "https://github.com/acme/web/pull/21",
            ]
        );
    }

    #[test]
    fn reads_the_owner_from_any_github_remote_form() {
        for remote in [
            "git@github.com:acme/web.git",
            "git@github.com-work:acme/web.git",
            "https://github.com/acme/web",
            "ssh://git@github.com/acme/web.git",
        ] {
            assert_eq!(remote_owner(remote).as_deref(), Some("acme"), "{remote}");
        }
        assert_eq!(remote_owner("git@gitlab.com:acme/web.git"), None);
    }

    #[test]
    fn finds_pr_urls_latest_mention_first_and_dedupes_variants() {
        let log = concat!(
            r#"{"content":"Opened https://github.com/acme/web/pull/12\n"}"#,
            "\n",
            r#"{"content":"see https://github.com/acme/api.v2/pull/7/files and #issuecomment"}"#,
            "\n",
            r#"{"content":"Updated https://github.com/acme/web/pull/12#issuecomment-99"}"#,
        );
        assert_eq!(
            urls_in(log),
            vec![
                "https://github.com/acme/web/pull/12",
                "https://github.com/acme/api.v2/pull/7",
            ]
        );
        assert!(urls_in("https://github.com/acme/web/issues/3").is_empty());
    }

    #[test]
    fn parses_a_pr_url() {
        assert_eq!(
            parse_pr_url("https://github.com/acme/web/pull/42"),
            Some(("acme".into(), "web".into(), 42))
        );
        assert_eq!(parse_pr_url("https://example.com/x"), None);
    }
}
