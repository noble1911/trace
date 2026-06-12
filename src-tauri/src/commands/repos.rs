//! Multi-repo support. The user configures a list of local git repositories;
//! each workspace (a Jira issue, or an exploratory session) is assigned to one
//! and remembered here. Every repo-rooted command resolves its repo through
//! `repo_for`. Persisted as `repos.json` next to the other config files.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::git;

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
        RepoMapping { pattern: pattern.into(), repo: repo.into() }
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
}

fn config_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("trace")
        .join("repos.json")
}

fn load() -> ReposConfig {
    if let Some(cfg) = std::fs::read_to_string(config_file())
        .ok()
        .and_then(|s| serde_json::from_str::<ReposConfig>(&s).ok())
    {
        return cfg;
    }
    // First run: migrate the old single-repo file into the list.
    let mut cfg = ReposConfig::default();
    if let Some(old) = crate::commands::agent::load_repo_path() {
        cfg.repos.push(old);
        let _ = save(&cfg);
    }
    cfg
}

fn save(cfg: &ReposConfig) -> Result<(), String> {
    let path = config_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    crate::helpers::restrict_perms(&path);
    Ok(())
}

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
    Ok(())
}

/// The repo a workspace is assigned to. Errors (prompting assignment) if none.
pub(crate) fn repo_for(workspace_id: &str) -> Result<String, String> {
    let cfg = load();
    if let Some(repo) = cfg.assignments.get(workspace_id) {
        return Ok(repo.clone());
    }
    // User-defined ticket→repo mapping (Settings → Repositories).
    if let Some(repo) = match_mapping(&cfg.mappings, workspace_id)
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
    format!("{repo}/.worktrees/{}", workspace_dirname(workspace_id))
}

/// Record an issue adopting a session's worktree dir (+ the repo assignment).
pub(crate) fn adopt_workspace_dir(
    issue_key: &str,
    dirname: &str,
    repo: &str,
) -> Result<(), String> {
    let mut cfg = load();
    cfg.dir_overrides
        .insert(issue_key.to_string(), dirname.to_string());
    cfg.assignments
        .insert(issue_key.to_string(), repo.to_string());
    save(&cfg)
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
pub fn list_repos() -> Vec<String> {
    load().repos
}

#[tauri::command]
pub fn add_repo(path: String) -> Result<Vec<String>, String> {
    let path = path.trim().to_string();
    validate_repo(&path)?;
    let mut cfg = load();
    if !cfg.repos.contains(&path) {
        cfg.repos.push(path);
    }
    save(&cfg)?;
    Ok(cfg.repos)
}

#[tauri::command]
pub fn remove_repo(path: String) -> Result<Vec<String>, String> {
    let mut cfg = load();
    cfg.repos.retain(|r| r != &path);
    cfg.assignments.retain(|_, v| v != &path);
    save(&cfg)?;
    Ok(cfg.repos)
}

#[tauri::command]
pub fn issue_repo(issue_key: String) -> Option<String> {
    load().assignments.get(&issue_key).cloned()
}

#[tauri::command]
pub fn set_issue_repo(issue_key: String, path: String) -> Result<(), String> {
    let mut cfg = load();
    if !cfg.repos.contains(&path) {
        return Err("That repository isn't configured.".to_string());
    }
    cfg.assignments.insert(issue_key, path);
    save(&cfg)
}

#[tauri::command]
pub fn list_repo_mappings() -> Vec<RepoMapping> {
    load().mappings
}

/// Replace the mapping list (the Settings editor owns ordering/content).
/// Sanitizes: trims patterns, drops empties and mappings to unknown repos.
#[tauri::command]
pub fn set_repo_mappings(mappings: Vec<RepoMapping>) -> Result<Vec<RepoMapping>, String> {
    let mut cfg = load();
    cfg.mappings = mappings
        .into_iter()
        .map(|mut m| {
            m.pattern = m.pattern.trim().to_string();
            m
        })
        .filter(|m| !m.pattern.is_empty() && cfg.repos.contains(&m.repo))
        .collect();
    let saved = cfg.mappings.clone();
    save(&cfg)?;
    Ok(saved)
}
