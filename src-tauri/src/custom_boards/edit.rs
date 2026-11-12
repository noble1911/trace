//! Board and column mutations, as pure functions over `BoardsFile` so every rule
//! is tested without a disk. Each checks everything before it changes anything;
//! `store::edit` also runs them on a copy, so a refusal never half-applies.
//! Card mutations are in `cards`.

use super::model::{Board, BoardsFile, Category, Column};

/// `name` trimmed with its whitespace collapsed (a newline in a board name would
/// otherwise reach an agent's system prompt), or a refusal naming `what` when
/// nothing is left.
pub fn clean_name(name: &str, what: &str) -> Result<String, String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(format!("{what} needs a name."));
    }
    Ok(name)
}

pub(super) fn board_mut<'a>(file: &'a mut BoardsFile, id: &str) -> Result<&'a mut Board, String> {
    file.boards
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or_else(|| no_board(id))
}

pub(super) fn no_board(id: &str) -> String {
    format!("There's no board {id}. It may have been deleted.")
}

fn column_index(board: &Board, column_id: &str) -> Result<usize, String> {
    board
        .columns
        .iter()
        .position(|c| c.id == column_id)
        .ok_or_else(|| format!("Board \"{}\" has no column {column_id}.", board.name))
}

/// The first card on `board` whose agent `is_running`, if any.
pub(super) fn running_card<'a>(
    board: &'a Board,
    is_running: &impl Fn(&str) -> bool,
) -> Option<&'a str> {
    board
        .cards
        .iter()
        .map(|c| c.key.as_str())
        .find(|k| is_running(k))
}

/// Add a board with the starting columns. `id` must be new.
pub fn create_board(file: &mut BoardsFile, id: String, name: &str) -> Result<Board, String> {
    let name = clean_name(name, "A board")?;
    if file.board(&id).is_some() {
        return Err(format!("A board with id {id} already exists."));
    }
    let board = Board::new(id, name);
    file.boards.push(board.clone());
    Ok(board)
}

pub fn rename_board(file: &mut BoardsFile, board_id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name, "A board")?;
    board_mut(file, board_id)?.name = name;
    Ok(())
}

/// Remove a board and its cards, refused while any card's agent runs. The cards'
/// worktrees and conversations are left alone: they may hold work not yet pushed.
pub fn delete_board(
    file: &mut BoardsFile,
    board_id: &str,
    is_running: impl Fn(&str) -> bool,
) -> Result<Board, String> {
    let at = file
        .boards
        .iter()
        .position(|b| b.id == board_id)
        .ok_or_else(|| no_board(board_id))?;
    if let Some(key) = running_card(&file.boards[at], &is_running) {
        return Err(format!(
            "The agent for {key} is running. Stop it before deleting this board."
        ));
    }
    Ok(file.boards.remove(at))
}

/// Add a column at the end. `id` must be new on the board.
pub fn add_column(
    file: &mut BoardsFile,
    board_id: &str,
    id: String,
    name: &str,
    category: Category,
) -> Result<(), String> {
    let name = clean_name(name, "A column")?;
    let board = board_mut(file, board_id)?;
    if board.column(&id).is_some() {
        return Err(format!(
            "Board \"{}\" already has a column {id}.",
            board.name
        ));
    }
    board.columns.push(Column { id, name, category });
    Ok(())
}

/// Rename and/or recategorise a column. `None` leaves that part as it is.
pub fn update_column(
    file: &mut BoardsFile,
    board_id: &str,
    column_id: &str,
    name: Option<&str>,
    category: Option<Category>,
) -> Result<(), String> {
    let name = name.map(|n| clean_name(n, "A column")).transpose()?;
    let board = board_mut(file, board_id)?;
    let at = column_index(board, column_id)?;
    let column = &mut board.columns[at];
    if let Some(name) = name {
        column.name = name;
    }
    if let Some(category) = category {
        column.category = category;
    }
    Ok(())
}

/// Move a column to `to_index` (past the end means last).
pub fn move_column(
    file: &mut BoardsFile,
    board_id: &str,
    column_id: &str,
    to_index: usize,
) -> Result<(), String> {
    let board = board_mut(file, board_id)?;
    let from = column_index(board, column_id)?;
    let column = board.columns.remove(from);
    let to = to_index.min(board.columns.len());
    board.columns.insert(to, column);
    Ok(())
}

/// Delete a column. Its cards go to `move_cards_to` (another column on the board),
/// in their order, after the cards already there; with cards and no target it's
/// refused, as is deleting a board's last column.
pub fn delete_column(
    file: &mut BoardsFile,
    board_id: &str,
    column_id: &str,
    move_cards_to: Option<&str>,
) -> Result<(), String> {
    let board = board_mut(file, board_id)?;
    let at = column_index(board, column_id)?;
    if board.columns.len() == 1 {
        return Err("A board needs at least one column.".to_string());
    }
    let has_cards = board.cards.iter().any(|c| c.column == column_id);
    match move_cards_to {
        Some(target) if target == column_id => {
            return Err("Move the cards to a different column.".to_string());
        }
        Some(target) => {
            column_index(board, target)?;
            let (moved, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut board.cards)
                .into_iter()
                .partition(|c| c.column == column_id);
            board.cards = kept;
            board.cards.extend(moved.into_iter().map(|mut c| {
                c.column = target.to_string();
                c
            }));
        }
        None if has_cards => {
            return Err(format!(
                "Column \"{}\" has cards. Choose a column to move them to first.",
                board.columns[at].name
            ));
        }
        None => {}
    }
    board.columns.remove(at);
    Ok(())
}

#[cfg(test)]
#[path = "edit_tests.rs"]
mod tests;
