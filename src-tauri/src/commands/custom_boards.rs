//! Custom-board editing: boards, columns and cards made in trace. Thin wrappers
//! over `custom_boards` (the IPC contract is in `docs/BOARDS_PLAN.md`). Reading a
//! board, moving a card and commenting go through the shared board commands in
//! `commands/issues.rs` with `provider: "custom"`.
//!
//! Deleting a board or card leaves its worktrees and conversations alone: they
//! may hold work not yet pushed, and the cleanup sweep or the Worktrees page
//! removes them. Either is refused while one of its agents runs.

use std::collections::HashSet;

use tauri::State;

use crate::custom_boards::cards::{CardPatch, NewCard};
use crate::custom_boards::CustomBoards;
use crate::issues::models::{BoardData, BoardSummary, Issue};
use crate::state::AppState;

/// Every workspace with an agent live or starting, on either transport. Each
/// lock is taken and dropped in turn, before the boards file's.
fn live_workspaces(state: &AppState) -> HashSet<String> {
    let mut ids: HashSet<String> = state.pty_sessions.lock().keys().cloned().collect();
    ids.extend(state.chat_agents.workspaces());
    ids.extend(state.starting.lock().iter().cloned());
    ids
}

fn boards() -> CustomBoards {
    CustomBoards::new()
}

#[tauri::command]
pub fn custom_board_create(name: String) -> Result<BoardSummary, String> {
    boards().create_board(&name)
}

#[tauri::command]
pub fn custom_board_rename(board_id: String, name: String) -> Result<(), String> {
    boards().rename_board(&board_id, &name)
}

/// Delete a board and its cards. Refused while any of its cards' agents runs.
#[tauri::command]
pub fn custom_board_delete(state: State<'_, AppState>, board_id: String) -> Result<(), String> {
    let live = live_workspaces(&state);
    boards().delete_board(&board_id, |key| live.contains(key))
}

/// Add a column at the end. `category`: `new` | `indeterminate` | `done`.
#[tauri::command]
pub fn custom_column_add(
    board_id: String,
    name: String,
    category: String,
) -> Result<BoardData, String> {
    boards().add_column(&board_id, &name, &category)
}

#[tauri::command]
pub fn custom_column_update(
    board_id: String,
    column_id: String,
    name: Option<String>,
    category: Option<String>,
) -> Result<BoardData, String> {
    boards().update_column(&board_id, &column_id, name.as_deref(), category.as_deref())
}

#[tauri::command]
pub fn custom_column_move(
    board_id: String,
    column_id: String,
    to_index: usize,
) -> Result<BoardData, String> {
    boards().move_column(&board_id, &column_id, to_index)
}

/// Delete a column. Its cards move to `move_cards_to`; with cards and none given,
/// or on a board's last column, it's refused.
#[tauri::command]
pub fn custom_column_delete(
    board_id: String,
    column_id: String,
    move_cards_to: Option<String>,
) -> Result<BoardData, String> {
    boards().delete_column(&board_id, &column_id, move_cards_to.as_deref())
}

/// Add a card (default: the first column, priority p2). Its key is the next
/// `local-<n>`.
#[tauri::command]
pub fn custom_card_create(
    board_id: String,
    summary: String,
    description: Option<String>,
    column_id: Option<String>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
) -> Result<Issue, String> {
    let card = NewCard {
        summary,
        description,
        column_id,
        priority,
        labels,
    };
    boards().create_card(&board_id, card)
}

/// Change a card. Omitted fields stay as they are; an empty description clears it.
#[tauri::command]
pub fn custom_card_update(
    key: String,
    summary: Option<String>,
    description: Option<String>,
    priority: Option<String>,
    labels: Option<Vec<String>>,
) -> Result<Issue, String> {
    let patch = CardPatch {
        summary,
        description,
        priority,
        labels,
    };
    boards().update_card(&key, patch)
}

/// Delete a card. Refused while its agent runs.
#[tauri::command]
pub fn custom_card_delete(state: State<'_, AppState>, key: String) -> Result<(), String> {
    let live = live_workspaces(&state);
    boards().delete_card(&key, |k| live.contains(k))
}
