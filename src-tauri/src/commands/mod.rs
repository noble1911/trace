//! Thin `#[tauri::command]` wrappers. Validation + delegation only — business
//! logic lives in `jira/`, `claude/`, and `git`.

pub mod agent;
pub mod diff;
pub mod editor;
pub mod groups;
pub mod jira;
pub mod pr;
pub mod repos;
pub mod session;
pub mod tests;
pub mod update;
pub mod worktrees;
