//! Multi-repo support. The user configures a list of local git repositories;
//! each workspace (a Jira issue, or an exploratory session) is assigned to one
//! and remembered here. Every repo-rooted command resolves its repo through
//! `repo_for`. Persisted as `repos.json` next to the other config files.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::git;
use crate::helpers::persist::{self, LoadGate, Style};

#[derive(Default, Serialize, Deserialize)]
struct ReposConfig {
    #[serde(default)]
    repos: Vec<String>,
    /// workspace id (issue key or session id) → repo path.
    #[serde(default)]
    assignments: HashMap<String, String>,
    /// workspace id → adopted worktree dir name. By convention a workspace
    /// lives in `.worktrees/<slugified-id>`; linking an exploratory session
    /// to an issue makes the issue adopt the session's existing directory
    /// instead — moving it would orphan the Claude conversation, which is
    /// keyed by absolute cwd.
    #[serde(default)]
    dir_overrides: HashMap<String, String>,
    /// User-defined ticket→repo mappings, edited in Settings. A ticket whose
    /// key contains `pattern` (case-insensitive) resolves to `repo`; first
    /// match wins. Checked after explicit assignments.
    #[serde(default)]
    mappings: Vec<RepoMapping>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoMapping {
    pub pattern: String,
    pub repo: String,
}

/// First mapping whose pattern the workspace id contains (case-insensitive).
fn match_mapping<'a>(mappings: &'a [RepoMapping], workspace_id: &str) -> Option<&'a str> {
    let id_upper = workspace_id.to_uppercase();
    mappings
        .iter()
        .find(|m| !m.pattern.is_empty() && id_upper.contains(&m.pattern.to_uppercase()))
        .map(|m| m.repo.as_str())
}

#[cfg(test)]
mod tests {
    use super::{match_mapping, RepoMapping};

    fn m(pattern: &str, repo: &str) -> RepoMapping {
        RepoMapping {
            pattern: pattern.into(),
            repo: repo.into(),
        }
    }

    #[test]
    fn mapping_is_contains_case_insensitive_first_wins() {
        let mappings = vec![m("TRACE", "/repos/trace"), m("TR", "/repos/other")];
        assert_eq!(match_mapping(&mappings, "TRACE-12"), Some("/repos/trace"));
        // Contains, not prefix; and case-insensitive both ways.
        assert_eq!(match_mapping(&[m("ace", "/r")], "TRACE-12"), Some("/r"));
        // First match wins over a later, equally-valid one.
        assert_eq!(match_mapping(&mappings, "TR-9"), Some("/repos/other"));
        // Empty patterns never match; no match → None.
        assert_eq!(match_mapping(&[m("", "/r")], "TRACE-12"), None);
        assert_eq!(match_mapping(&mappings, "OTHER-1"), None);
    }

    #[test]
    fn mapping_matches_a_summary_tag_not_just_the_key() {
        // "[BE]" lives in the title, not the key — `repo_for_matching` searches
        // "<key> <summary> <labels>", so it matches; key-only would miss it.
        let mappings = vec![m("[BE]", "/repos/be")];
        assert_eq!(
            match_mapping(&mappings, "PM-1954 [BE] Remove echo scaffolding"),
            Some("/repos/be")
        );
        assert_eq!(match_mapping(&mappings, "PM-1954"), None);
    }
}

fn config_file() -> PathBuf {
    crate::helpers::trace_dir().join("repos.json")
}

/// What a missing `repos.json` means. First run: migrate the old single-repo file
/// into the list, which is saved with the first real change.
fn first_run_config() -> ReposConfig {
    let mut cfg = ReposConfig::default();
    if let Some(old) = crate::commands::agent::load_repo_path() {
        cfg.repos.push(old);
    }
    cfg
}

fn read() -> Result<ReposConfig, String> {
    Ok(persist::read_json(&config_file())?.unwrap_or_else(first_run_config))
}

/// The config for read-only callers: a read failure is logged and reads as empty. It
/// can't reach the disk, because every write goes through `update`.
fn load() -> ReposConfig {
    read().unwrap_or_else(|e| {
        eprintln!("trace: {e}");
        ReposConfig::default()
    })
}

/// Load, mutate and save `repos.json`, safe against other threads and another trace.
fn update<R>(f: impl FnOnce(&mut ReposConfig) -> R) -> Result<R, String> {
    persist::update_or(&config_file(), Style::Pretty, first_run_config, f)
}

/// Settings holds the whole mapping list and saves it back whole.
static MAPPINGS_COPY: LoadGate = LoadGate::new();

fn validate_repo(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Choose a folder on your machine.".to_string());
    }
    if path.starts_with("http://")
        || path.starts_with("https://")
        || path.starts_with("git@")
        || path.contains("://")
    {
        return Err("That looks like a remote URL — trace needs a local clone path.".to_string());
    }
    if !git::is_git_repo(path) {
        return Err(format!("{path} isn't a git repository."));
    }
    super::repo_guard::outside_config(path)
}

/// The repo a workspace is assigned to. Errors (prompting assignment) if none.
pub(crate) fn repo_for(workspace_id: &str) -> Result<String, String> {
    resolve_repo(workspace_id, workspace_id)
}

/// Like `repo_for`, but also matches mappings against `match_text` (the ticket
/// summary + labels) — tags like "[BE]" usually live in the title, not the key.
/// Used at start; `start_agent` then pins the result so the summary-less callers
/// (diff, PR, tests) resolve the same checkout via the saved assignment.
pub(crate) fn repo_for_matching(workspace_id: &str, match_text: &str) -> Result<String, String> {
    let haystack = format!("{workspace_id} {match_text}");
    resolve_repo(workspace_id, &haystack)
}

fn resolve_repo(workspace_id: &str, mapping_haystack: &str) -> Result<String, String> {
    let cfg = read()?;
    if let Some(repo) = cfg.assignments.get(workspace_id) {
        return Ok(repo.clone());
    }
    // User-defined ticket→repo mapping (Settings → Repositories).
    if let Some(repo) = match_mapping(&cfg.mappings, mapping_haystack)
        .filter(|r| cfg.repos.iter().any(|known| known == r))
    {
        return Ok(repo.to_string());
    }
    // With exactly one configured repo there's no ambiguity — auto-assign so
    // board-drag auto-start works without opening the card to pick.
    if cfg.repos.len() == 1 {
        return Ok(cfg.repos[0].clone());
    }
    Err("No repository assigned yet — pick one to start.".to_string())
}

/// Pin a workspace to a repo so later commands (diff, PR, tests) resolve the
/// same checkout without re-running (summary-dependent) mapping resolution.
pub(crate) fn assign_repo(workspace_id: &str, repo: &str) -> Result<(), String> {
    update(|cfg| {
        cfg.assignments
            .insert(workspace_id.to_string(), repo.to_string());
    })
}

/// The worktree directory NAME for a workspace: an adopted dir if linked,
/// else the conventional slugified id.
pub(crate) fn workspace_dirname(workspace_id: &str) -> String {
    load()
        .dir_overrides
        .get(workspace_id)
        .cloned()
        .unwrap_or_else(|| crate::helpers::slugify(workspace_id))
}

/// Full worktree path for a workspace under `repo`. Every command that
/// touches a workspace's checkout derives the path through here.
pub(crate) fn workspace_dir(repo: &str, workspace_id: &str) -> String {
    crate::platform::paths::worktree_dir(repo, &workspace_dirname(workspace_id))
}

/// Record an issue adopting a session's worktree dir (+ the repo assignment).
pub(crate) fn adopt_workspace_dir(
    issue_key: &str,
    dirname: &str,
    repo: &str,
) -> Result<(), String> {
    update(|cfg| {
        cfg.dir_overrides
            .insert(issue_key.to_string(), dirname.to_string());
        cfg.assignments
            .insert(issue_key.to_string(), repo.to_string());
    })
}

/// Workspace ids that adopted the worktree dir `dirname`. An error when unknown:
/// this decides whether a checkout is safe to delete.
pub(crate) fn dir_adopters(dirname: &str) -> Result<Vec<String>, String> {
    Ok(read()?
        .dir_overrides
        .into_iter()
        .filter(|(_, dir)| dir == dirname)
        .map(|(id, _)| id)
        .collect())
}

/// Drop a deleted workspace's adoption, so it no longer counts as a co-owner of
/// the dir (see `worktrees::remove_for_workspace`). No-op when there is none.
pub(crate) fn forget_dir_override(workspace_id: &str) -> Result<(), String> {
    update(|cfg| {
        cfg.dir_overrides.remove(workspace_id);
    })
}

/// Every workspace id with a pinned repo, paired with that repo — every ticket
/// workspace trace has started (`start_agent` pins each; an issue adopting a
/// session's dir is pinned too). Cleanup sweeps walk these.
pub(crate) fn assigned_workspaces() -> Vec<(String, String)> {
    load().assignments.into_iter().collect()
}

/// Every workspace id that adopted another's worktree dir → that dir name, read
/// once, for naming a whole listing of worktrees (`repo_catalog::owners`).
pub(crate) fn dir_overrides() -> HashMap<String, String> {
    load().dir_overrides
}

/// All configured repos, in the order the user added them.
pub(crate) fn all_repos() -> Vec<String> {
    load().repos
}

/// First configured repo — the default for exploratory sessions and as a
/// fallback when a workspace has no explicit assignment.
pub(crate) fn default_repo() -> Option<String> {
    load().repos.into_iter().next()
}

#[tauri::command]
pub fn list_repos() -> Result<Vec<String>, String> {
    Ok(read()?.repos)
}

#[tauri::command]
pub fn add_repo(path: String) -> Result<Vec<String>, String> {
    let path = path.trim().to_string();
    validate_repo(&path)?;
    let repos = update(|cfg| {
        if !cfg.repos.contains(&path) {
            cfg.repos.push(path.clone());
        }
        cfg.repos.clone()
    })?;
    // A repo removed and added back rejoins its record (by remote), so its setup returns.
    let remote = crate::repo_catalog::origin_of(&path);
    let _ = crate::repo_catalog::store::update(|cat| cat.add_local(&path, remote, None));
    Ok(repos)
}

#[tauri::command]
pub fn remove_repo(path: String) -> Result<Vec<String>, String> {
    update(|cfg| {
        cfg.repos.retain(|r| r != &path);
        cfg.assignments.retain(|_, v| v != &path);
        cfg.repos.clone()
    })
    .inspect(|_| {
        // Its setup stays with a hosted repo's record, for when it's cloned again.
        let _ = crate::repo_catalog::store::update(|cat| cat.forget_local(&path));
        super::board_settings::forget_repo(&path);
    })
}

#[tauri::command]
pub fn issue_repo(issue_key: String) -> Result<Option<String>, String> {
    Ok(read()?.assignments.get(&issue_key).cloned())
}

#[tauri::command]
pub fn set_issue_repo(issue_key: String, path: String) -> Result<(), String> {
    update(|cfg| {
        if !cfg.repos.contains(&path) {
            return Err("That repository isn't configured.".to_string());
        }
        cfg.assignments.insert(issue_key, path);
        Ok(())
    })?
}

#[tauri::command]
pub fn list_repo_mappings() -> Result<Vec<RepoMapping>, String> {
    MAPPINGS_COPY.observe(read().map(|cfg| cfg.mappings))
}

/// Replace the mapping list (the Settings editor owns ordering/content).
/// Sanitizes: trims patterns, drops empties and mappings to unknown repos.
#[tauri::command]
pub fn set_repo_mappings(mappings: Vec<RepoMapping>) -> Result<Vec<RepoMapping>, String> {
    MAPPINGS_COPY.check()?;
    update(|cfg| {
        cfg.mappings = mappings
            .into_iter()
            .map(|mut m| {
                m.pattern = m.pattern.trim().to_string();
                m
            })
            .filter(|m| !m.pattern.is_empty() && cfg.repos.contains(&m.repo))
            .collect();
        cfg.mappings.clone()
    })
}
