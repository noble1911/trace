//! The operations behind `commands/custom_boards.rs`: each is one locked edit of
//! the file (`store::edit`) running a pure mutation (`edit`, `cards`), answering
//! in the shapes the IPC contract fixes (`docs/BOARDS_PLAN.md`).
//!
//! The ones that delete take `is_running`, the live agents the command saw:
//! taken before the file's lock, so no `AppState` lock is held with it.

use super::cards::{self, CardPatch, NewCard};
use super::model::{fresh_id, now_iso, BoardsFile, Category};
use super::{edit, store, view, CustomBoards};
use crate::issues::models::{BoardData, BoardSummary, Issue};

impl CustomBoards {
    /// Apply `f` to the file, then answer with board `board_id` as it now is.
    fn edit_board(
        &self,
        board_id: &str,
        f: impl FnOnce(&mut BoardsFile) -> Result<(), String>,
    ) -> Result<BoardData, String> {
        store::edit(&self.path, |file| {
            f(file)?;
            file.board(board_id)
                .map(view::board_data)
                .ok_or_else(|| edit::no_board(board_id))
        })
    }

    /// The card `key` as an `Issue`, from a file that has it.
    fn issue_of(file: &BoardsFile, key: &str) -> Result<Issue, String> {
        file.find_card(key)
            .map(|(board, card)| view::issue(board, card))
            .ok_or_else(|| format!("There's no card {key}."))
    }

    pub fn create_board(&self, name: &str) -> Result<BoardSummary, String> {
        store::edit(&self.path, |file| {
            let id = fresh_id(|id| file.board(id).is_some());
            edit::create_board(file, id, name).map(|b| view::summary(&b))
        })
    }

    pub fn rename_board(&self, board_id: &str, name: &str) -> Result<(), String> {
        store::edit(&self.path, |file| edit::rename_board(file, board_id, name))
    }

    /// Delete a board and its cards; their worktrees are left alone.
    pub fn delete_board(
        &self,
        board_id: &str,
        is_running: impl Fn(&str) -> bool,
    ) -> Result<(), String> {
        store::edit(&self.path, |file| {
            edit::delete_board(file, board_id, is_running).map(|_| ())
        })
    }

    pub fn add_column(
        &self,
        board_id: &str,
        name: &str,
        category: &str,
    ) -> Result<BoardData, String> {
        let category = Category::parse(category)?;
        self.edit_board(board_id, |file| {
            let taken = file
                .board(board_id)
                .map(|b| b.columns.iter().map(|c| c.id.clone()).collect::<Vec<_>>())
                .unwrap_or_default();
            let id = fresh_id(|id| taken.iter().any(|t| t == id));
            edit::add_column(file, board_id, id, name, category)
        })
    }

    pub fn update_column(
        &self,
        board_id: &str,
        column_id: &str,
        name: Option<&str>,
        category: Option<&str>,
    ) -> Result<BoardData, String> {
        let category = category.map(Category::parse).transpose()?;
        self.edit_board(board_id, |file| {
            edit::update_column(file, board_id, column_id, name, category)
        })
    }

    pub fn move_column(
        &self,
        board_id: &str,
        column_id: &str,
        to_index: usize,
    ) -> Result<BoardData, String> {
        self.edit_board(board_id, |file| {
            edit::move_column(file, board_id, column_id, to_index)
        })
    }

    pub fn delete_column(
        &self,
        board_id: &str,
        column_id: &str,
        move_cards_to: Option<&str>,
    ) -> Result<BoardData, String> {
        self.edit_board(board_id, |file| {
            edit::delete_column(file, board_id, column_id, move_cards_to)
        })
    }

    pub fn create_card(&self, board_id: &str, card: NewCard) -> Result<Issue, String> {
        let created = now_iso();
        store::edit(&self.path, |file| {
            let card = cards::create_card(file, board_id, card, created)?;
            Self::issue_of(file, &card.key)
        })
    }

    pub fn update_card(&self, key: &str, patch: CardPatch) -> Result<Issue, String> {
        store::edit(&self.path, |file| {
            cards::update_card(file, key, patch)?;
            Self::issue_of(file, key)
        })
    }

    /// Delete a card; its worktree is left alone.
    pub fn delete_card(&self, key: &str, is_running: impl Fn(&str) -> bool) -> Result<(), String> {
        store::edit(&self.path, |file| cards::delete_card(file, key, is_running))
    }
}
