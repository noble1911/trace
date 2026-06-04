//! Pull-request commands. Shells out to `git` and `gh` from the issue's
//! worktree so the user's existing `gh auth` and ssh credentials apply without
//! any in-app OAuth dance.

use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::helpers::slugify;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaisedPr {
    pub url: String,
}

/// One CI/status check on a PR. `status` is normalised to ok | fail | pending
/// to map onto the design's `.check` variants.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCheck {
    pub name: String,
    pub status: String,
    pub meta: String,
}

/// One review on a PR. `action` is approved | changes | commented.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReview {
    pub who: String,
    pub action: String,
    pub when: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetails {
    pub number: u64,
    pub title: String,
    /// OPEN | MERGED | CLOSED.
    pub state: String,
    pub is_draft: bool,
    pub additions: u64,
    pub deletions: u64,
    pub checks: Vec<PrCheck>,
    pub reviews: Vec<PrReview>,
}

/// Normalise a check's GitHub status/conclusion to ok | fail | pending.
fn check_status(status: &str, conclusion: &str, state: &str) -> String {
    // CheckRun: status COMPLETED + conclusion; otherwise in-flight.
    // StatusContext: a single `state` field.
    let v = if !conclusion.is_empty() {
        conclusion
    } else if !state.is_empty() {
        state
    } else {
        status
    };
    match v.to_ascii_uppercase().as_str() {
        "SUCCESS" | "NEUTRAL" | "SKIPPED" => "ok",
        "FAILURE" | "ERROR" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE" => {
            "fail"
        }
        _ => "pending",
    }
    .to_string()
}

/// PR detail for the issue's tab: state, diffstat, CI checks, and reviews.
/// Reads via `gh` from the repo so the user's existing auth applies.
#[tauri::command]
pub fn pr_details(state: State<'_, AppState>, pr_url: String) -> Result<PrDetails, String> {
    let repo = read_repo(&state)?;
    let out = Command::new("gh")
        .args([
            "pr",
            "view",
            &pr_url,
            "--json",
            "number,title,state,isDraft,additions,deletions,statusCheckRollup,reviews",
        ])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("gh pr view failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!("gh pr view failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("bad gh json: {e}"))?;

    let str_at = |val: &Value, key: &str| val.get(key).and_then(Value::as_str).unwrap_or("").to_string();

    let mut checks = Vec::new();
    if let Some(arr) = v.get("statusCheckRollup").and_then(Value::as_array) {
        for c in arr {
            let is_check_run = c.get("__typename").and_then(Value::as_str) == Some("CheckRun");
            let name = if is_check_run { str_at(c, "name") } else { str_at(c, "context") };
            let status = check_status(
                &str_at(c, "status"),
                &str_at(c, "conclusion"),
                &str_at(c, "state"),
            );
            let meta = if is_check_run {
                str_at(c, "workflowName")
            } else {
                str_at(c, "description")
            };
            checks.push(PrCheck {
                name: if name.is_empty() { "check".to_string() } else { name },
                status,
                meta,
            });
        }
    }

    let mut reviews = Vec::new();
    if let Some(arr) = v.get("reviews").and_then(Value::as_array) {
        for r in arr {
            let who = r
                .get("author")
                .and_then(|a| a.get("login"))
                .and_then(Value::as_str)
                .unwrap_or("someone")
                .to_string();
            let action = match str_at(r, "state").as_str() {
                "APPROVED" => "approved",
                "CHANGES_REQUESTED" => "changes",
                _ => "commented",
            }
            .to_string();
            reviews.push(PrReview { who, action, when: str_at(r, "submittedAt") });
        }
    }

    Ok(PrDetails {
        number: v.get("number").and_then(Value::as_u64).unwrap_or(0),
        title: str_at(&v, "title"),
        state: str_at(&v, "state"),
        is_draft: v.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        additions: v.get("additions").and_then(Value::as_u64).unwrap_or(0),
        deletions: v.get("deletions").and_then(Value::as_u64).unwrap_or(0),
        checks,
        reviews,
    })
}

fn read_repo(state: &AppState) -> Result<String, String> {
    state
        .repo_path
        .read()
        .clone()
        .ok_or_else(|| "Choose a repository folder in Settings first.".to_string())
}

/// Raise a PR for the given issue's worktree. Idempotent: if the branch is
/// already pushed and a PR exists, returns that PR's URL instead of erroring.
#[tauri::command]
pub fn raise_pr(
    state: State<'_, AppState>,
    issue_key: String,
    title: String,
    body: String,
) -> Result<RaisedPr, String> {
    let repo = read_repo(&state)?;
    let slug = slugify(&issue_key);
    let worktree = format!("{repo}/.worktrees/{slug}");
    let branch = format!("workspace/{slug}");

    if !std::path::Path::new(&worktree).exists() {
        return Err(format!(
            "No worktree for {issue_key} — start a Claude session on this issue first."
        ));
    }

    // Push the branch. `-u` sets upstream on the first push; if upstream is
    // already set, fall through to a plain push.
    let push = Command::new("git")
        .args(["push", "-u", "origin", &branch])
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("git push failed to start: {e}"))?;
    if !push.status.success() {
        let stderr = String::from_utf8_lossy(&push.stderr);
        // Already-set upstream is harmless; retry without -u.
        let retry = Command::new("git")
            .args(["push", "origin", &branch])
            .current_dir(&worktree)
            .output()
            .map_err(|e| format!("git push failed: {e}"))?;
        if !retry.status.success() {
            return Err(format!(
                "git push failed: {}",
                String::from_utf8_lossy(&retry.stderr).trim()
            ));
        }
        // First push failed but the retry succeeded — drop the noisy stderr.
        let _ = stderr;
    }

    // Create the PR. `gh` reads the title/body via stdin to avoid shell quoting
    // headaches for multi-line bodies.
    let create = Command::new("gh")
        .args(["pr", "create", "--title", &title, "--body", &body, "--head", &branch])
        .current_dir(&worktree)
        .output()
        .map_err(|e| format!("gh pr create failed to start: {e}"))?;

    if create.status.success() {
        let url = String::from_utf8_lossy(&create.stdout).trim().to_string();
        return Ok(RaisedPr { url });
    }

    // Common case: PR already exists for this branch — look it up.
    let stderr = String::from_utf8_lossy(&create.stderr);
    if stderr.contains("already exists") {
        let view = Command::new("gh")
            .args(["pr", "view", "--head", &branch, "--json", "url", "--jq", ".url"])
            .current_dir(&worktree)
            .output()
            .map_err(|e| format!("gh pr view failed: {e}"))?;
        if view.status.success() {
            let url = String::from_utf8_lossy(&view.stdout).trim().to_string();
            if !url.is_empty() {
                return Ok(RaisedPr { url });
            }
        }
    }
    Err(format!("gh pr create failed: {}", stderr.trim()))
}

/// Merge a PR by URL. `method` is `squash` | `merge` | `rebase` (default squash).
#[tauri::command]
pub fn merge_pr(
    state: State<'_, AppState>,
    pr_url: String,
    method: Option<String>,
) -> Result<(), String> {
    let repo = read_repo(&state)?;
    let flag = match method.as_deref().unwrap_or("squash") {
        "merge" => "--merge",
        "rebase" => "--rebase",
        _ => "--squash",
    };
    let out = Command::new("gh")
        .args(["pr", "merge", &pr_url, flag, "--delete-branch"])
        .current_dir(&repo)
        .output()
        .map_err(|e| format!("gh pr merge failed to start: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "gh pr merge failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}
