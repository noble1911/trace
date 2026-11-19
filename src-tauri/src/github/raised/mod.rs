//! The PRs each workspace raised, for the Pull requests page: the same two
//! sources as a workspace's own PR tab (`links`), for many workspaces at once.
//!
//! - **Its branch**: one `gh pr list` per repo (`repo_prs::by_branch`) answers
//!   every workspace in that repo.
//! - **Its conversations**: each PR a `gh pr create` in them printed
//!   (`links::created_in_dated`). This is what finds a PR an agent raised from a
//!   branch it made, or in another repo than its worktree's — the usual case for
//!   a ticket's agent, whose worktree stays on `workspace/<key>`.
//!
//! Then one lookup per repo (`pr_lookup`) gives every PR its state and title.
//! Which workspaces, and where each one's sources are: `sources`.

pub mod sources;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

use serde::Serialize;

use super::pr_lookup::{lookup, PrSummary};
use super::repo_prs::PrRef;

/// Most PRs listed per workspace, newest first: a long-lived ticket's agent can
/// raise dozens, and the oldest are long merged.
const MAX_PER_WORKSPACE: usize = 20;

/// A workspace to look in, resolved by `sources`.
pub struct Workspace {
    pub id: String,
    /// Its repo's root, which keys the per-repo branch listing.
    pub repo: String,
    /// The branch whose PR is this workspace's, when one is (not a default branch,
    /// not a repo root borrowed by a ticket whose worktree is gone).
    pub branch: Option<String>,
    /// Its Claude conversation logs (a session's own and its agents').
    pub logs: Vec<PathBuf>,
}

/// One PR and the workspace that raised it.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RaisedPr {
    pub workspace_id: String,
    #[serde(flatten)]
    pub pr: PrSummary,
}

/// Every PR the workspaces raised: each one's branch PR first, then the ones its
/// conversations created, newest first across all its logs. A PR with no state
/// from either source is left out: there's no tab to put it in.
pub fn collect(workspaces: &[Workspace]) -> Vec<RaisedPr> {
    let mut by_repo: HashMap<&str, HashMap<String, PrRef>> = HashMap::new();
    // Branch PRs as `gh pr list` saw them: a fallback if the lookup misses one.
    let mut listed: HashMap<String, (PrRef, String)> = HashMap::new();
    let mut wanted: Vec<(&str, Vec<String>)> = Vec::new();
    for ws in workspaces {
        let mut urls: Vec<String> = Vec::new();
        if let Some(branch) = &ws.branch {
            let prs = by_repo
                .entry(ws.repo.as_str())
                .or_insert_with(|| super::repo_prs::by_branch(&ws.repo));
            if let Some(pr) = prs.get(branch) {
                urls.push(pr.url.clone());
                listed.insert(pr.url.clone(), (pr.clone(), branch.clone()));
            }
        }
        let dated = ws.logs.iter().flat_map(created_in_file).collect();
        for url in newest_first(dated) {
            if !urls.contains(&url) {
                urls.push(url);
            }
        }
        urls.truncate(MAX_PER_WORKSPACE);
        wanted.push((ws.id.as_str(), urls));
    }
    let all: Vec<String> = wanted.iter().flat_map(|(_, u)| u.clone()).collect();
    let found = lookup(&all);
    let summary = |url: &str| {
        found.get(url).cloned().or_else(|| {
            let (pr, branch) = listed.get(url)?;
            Some(PrSummary {
                url: pr.url.clone(),
                number: pr.number,
                state: pr.state.clone(),
                title: String::new(),
                branch: branch.clone(),
                author: None,
            })
        })
    };
    wanted
        .into_iter()
        .flat_map(|(id, urls)| urls.into_iter().map(move |url| (id, url)))
        .filter_map(|(id, url)| {
            Some(RaisedPr {
                workspace_id: id.to_string(),
                pr: summary(&url)?,
            })
        })
        .collect()
}

/// PR URLs from several logs, newest first by when each was raised (a PR in two
/// logs counts at its latest). ISO times sort as text; one without a time sorts last.
fn newest_first(mut dated: Vec<(String, String)>) -> Vec<String> {
    dated.sort_by(|a, b| b.1.cmp(&a.1));
    let mut out: Vec<String> = Vec::new();
    for (url, _) in dated {
        if !out.contains(&url) {
            out.push(url);
        }
    }
    out
}

/// A log's PRs as of its size and modification time: logs run to megabytes and
/// the page re-asks every minute, so an unchanged one isn't read again.
type LogCache = HashMap<PathBuf, (u64, SystemTime, Vec<(String, String)>)>;
static CREATED: Mutex<Option<LogCache>> = Mutex::new(None);

fn created_in_file(path: &PathBuf) -> Vec<(String, String)> {
    let Ok(meta) = std::fs::metadata(path) else {
        return Vec::new();
    };
    let stamp = (
        meta.len(),
        meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
    );
    {
        let guard = CREATED.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((len, at, urls)) = guard.as_ref().and_then(|c| c.get(path)) {
            if (*len, *at) == stamp {
                return urls.clone();
            }
        }
    }
    let urls = std::fs::read_to_string(path)
        .map(|raw| super::links::created_in_dated(&raw))
        .unwrap_or_default();
    let mut guard = CREATED.lock().unwrap_or_else(|p| p.into_inner());
    guard
        .get_or_insert_with(HashMap::new)
        .insert(path.clone(), (stamp.0, stamp.1, urls.clone()));
    urls
}

#[cfg(test)]
mod tests {
    use super::newest_first;

    #[test]
    fn orders_prs_from_several_logs_by_when_they_were_raised() {
        let d = |u: &str, t: &str| (u.to_string(), t.to_string());
        let dated = vec![
            // The session's own log, newest first…
            d("s/2", "2026-11-10T10:00:00Z"),
            d("s/1", "2026-11-01T10:00:00Z"),
            // …then a companion's, whose PR is newer than both.
            d("c/9", "2026-11-18T10:00:00Z"),
            d("s/1", "2026-11-12T10:00:00Z"),
            d("old", ""),
        ];
        assert_eq!(newest_first(dated), ["c/9", "s/1", "s/2", "old"]);
    }
}
