//! Integrations → Skills: the GitHub repos of skills the user added as sources,
//! what each holds, and installing their plugins (`skills/`, `docs/SKILLS_PLAN.md`).
//! Thin wrappers: the repo name is checked here, read over GitHub with trace's
//! token, and only a repo that holds skills is added. An install names one of
//! those sources and one of trace's repositories, never any folder or repo.

use serde::Serialize;

use crate::github::{account, clone};
use crate::skills::cli::Scope;
use crate::skills::installs::{self, Installs};
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

/// One of the sources the user added, as stored.
fn added_source(repo: &str) -> Result<String, String> {
    let repo = checked(repo)?;
    store::list()
        .into_iter()
        .find(|s| s.repo.eq_ignore_ascii_case(&repo))
        .map(|s| s.repo)
        .ok_or_else(|| format!("{repo} isn't one of your skill sources."))
}

/// One of trace's repositories (Settings → Repositories), for a project's scopes.
fn known_repo(scope: Scope, repo: Option<String>) -> Result<Option<String>, String> {
    if scope == Scope::User {
        return Ok(None);
    }
    let repo = repo.ok_or("Pick a repository to install it in.")?;
    if !crate::commands::repos::list_repos()?.contains(&repo) {
        return Err(format!("{repo} isn't one of trace's repositories."));
    }
    Ok(Some(repo))
}

/// Run blocking `claude plugin` / git work off the main thread.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// What's installed: for the user everywhere, and in each of trace's repositories.
#[tauri::command]
pub async fn skills_installs() -> Result<Installs, String> {
    blocking(|| installs::read(&crate::commands::repos::list_repos()?)).await
}

/// Install `plugin` from source `source` for `scope` (in `repo`, for a project's).
#[tauri::command]
pub async fn skills_install(
    source: String,
    plugin: String,
    scope: Scope,
    repo: Option<String>,
) -> Result<String, String> {
    let source = added_source(&source)?;
    let repo = known_repo(scope, repo)?;
    blocking(move || installs::install(&source, &plugin, scope, repo.as_deref())).await
}

/// Remove plugin `id` (`<plugin>@<marketplace>`) from `scope`.
#[tauri::command]
pub async fn skills_uninstall(
    id: String,
    scope: Scope,
    repo: Option<String>,
) -> Result<String, String> {
    let repo = known_repo(scope, repo)?;
    blocking(move || installs::uninstall(&id, scope, repo.as_deref())).await
}

/// Update plugin `id` in `scope` to its marketplace's latest.
#[tauri::command]
pub async fn skills_update(
    id: String,
    scope: Scope,
    repo: Option<String>,
) -> Result<String, String> {
    let repo = known_repo(scope, repo)?;
    blocking(move || installs::update(&id, scope, repo.as_deref())).await
}
