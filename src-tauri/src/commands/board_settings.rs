//! Board settings: a board's own brief and repositories, for any board (Jira,
//! Pylon or custom), keyed `provider:boardId`. Thin wrappers over
//! `board_settings`; the IPC contract is in `docs/BOARDS_PLAN.md`.

use crate::board_settings::start_repo::{self, StartRepo};
use crate::board_settings::{self, store, BoardSettings};
use crate::commands::repos;

/// A board's settings; the defaults when none were saved.
#[tauri::command]
pub fn board_settings_get(board_key: String) -> Result<BoardSettings, String> {
    board_settings::check_key(&board_key)?;
    store::get(&store::default_path(), &board_key)
}

/// Validate and save a board's settings (repos must be configured ones, the
/// default one of them, the brief trimmed and capped); answers them as saved.
/// Saving the defaults removes the board's entry.
#[tauri::command]
pub fn board_settings_set(
    board_key: String,
    settings: BoardSettings,
) -> Result<BoardSettings, String> {
    board_settings::check_key(&board_key)?;
    let configured = repos::list_repos()?;
    let settings = board_settings::validate(settings, &configured)?;
    store::set(&store::default_path(), &board_key, settings)
}

/// Before a ticket's agent starts: when its board's settings pick the repo and the
/// ticket has none saved, pin it as the ticket's assignment, as the repo picker
/// does (`set_issue_repo`), so the start and later diff/PR/tests resolve it.
/// Several board repos and no default is the "No repository assigned" error the
/// picker opens on. A missing or unreadable settings file never blocks a start:
/// today's rules apply.
pub(crate) fn pin_board_repo(issue_key: &str, board_key: Option<&str>) -> Result<(), String> {
    let Some(key) = board_key.filter(|k| board_settings::check_key(k).is_ok()) else {
        return Ok(());
    };
    let settings = match store::get(&store::default_path(), key) {
        Ok(settings) => settings,
        Err(e) => {
            eprintln!("trace: board settings unreadable, using today's repo rules: {e}");
            return Ok(());
        }
    };
    if settings.repos.is_empty() {
        return Ok(());
    }
    let saved = repos::issue_repo(issue_key.to_string())?;
    let configured = repos::list_repos()?;
    match start_repo::resolve(saved.as_deref(), &settings, &configured)? {
        StartRepo::Board(repo) => repos::set_issue_repo(issue_key.to_string(), repo),
        StartRepo::Saved(_) | StartRepo::Fallback => Ok(()),
    }
}

/// After a repo is removed from trace: drop it from every board's settings.
/// Best-effort: the removal itself already happened, and a start ignores repos
/// that are no longer configured.
pub(crate) fn forget_repo(repo: &str) {
    if let Err(e) = store::drop_repo(&store::default_path(), repo) {
        eprintln!("trace: couldn't drop a removed repo from board settings: {e}");
    }
}

/// After a custom board is deleted: forget its settings. Best-effort, as above.
pub(crate) fn forget_custom_board(board_id: &str) {
    let key = format!("custom:{board_id}");
    if let Err(e) = store::remove(&store::default_path(), &key) {
        eprintln!("trace: couldn't remove a deleted board's settings: {e}");
    }
}
