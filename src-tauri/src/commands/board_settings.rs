//! Board settings: a board's own brief and repositories, for any board (Jira,
//! Pylon or custom), keyed `provider:boardId`. Thin wrappers over
//! `board_settings`; the IPC contract is in `docs/BOARDS_PLAN.md`.

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
