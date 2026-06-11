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
    // With exactly one configured repo there's no ambiguity — auto-assign so
    // board-drag auto-start works without opening the card to pick.
    if cfg.repos.len() == 1 {
        return Ok(cfg.repos[0].clone());
    }
    Err("No repository assigned yet — open the card and pick one to start.".to_string())
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
