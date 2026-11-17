//! Integrations → Skills: the GitHub repos of skills the user added as sources,
//! and what each holds (`skills/`, `docs/SKILLS_PLAN.md`). Thin wrappers: the
//! repo name is checked here, read over GitHub with trace's token, and only a
//! repo that holds skills is added.

use serde::Serialize;

use crate::github::{account, clone};
use crate::skills::store::{self, SourceRecord};
use crate::skills::{source, SourceView};

/// After adding: the list, and the source as read.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    pub sources: Vec<SourceRecord>,
    pub source: SourceView,
}

fn checked(repo: &str) -> Result<String, String> {
    clone::parse_full_name(repo.trim()).map(|r| r.full_name())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// The sources added so far.
#[tauri::command]
pub fn skills_sources() -> Vec<SourceRecord> {
    store::list()
}

/// What `repo` holds: its plugins (a marketplace) or its skills.
#[tauri::command]
pub async fn skills_read_source(repo: String) -> Result<SourceView, String> {
    let repo = checked(&repo)?;
    let token = account::require_token()?;
    source::read(&token, &repo).await
}

/// Add `repo` as a source, once it's been read and found to hold skills.
#[tauri::command]
pub async fn skills_add_source(repo: String) -> Result<Added, String> {
    let repo = checked(&repo)?;
    let token = account::require_token()?;
    let view = source::read(&token, &repo).await?;
    let sources = store::add(&view.repo, now_ms())?;
    Ok(Added {
        sources,
        source: view,
    })
}

/// Stop listing `repo`. Anything installed from it stays installed.
#[tauri::command]
pub fn skills_remove_source(repo: String) -> Result<Vec<SourceRecord>, String> {
    store::remove(&checked(&repo)?)
}
