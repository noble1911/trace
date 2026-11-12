//! Card mutations, pure over `BoardsFile` like `edit`: create, update, delete,
//! move between columns (the tracker "transition") and comment.

use super::edit::board_mut;
use super::model::{Board, BoardsFile, Card, Comment, DEFAULT_PRIORITY, KEY_PREFIX};

/// A card to create. `None`s take the defaults: the board's first column,
/// priority p2, no description or labels.
#[derive(Default)]
pub struct NewCard {
    pub summary: String,
    pub description: Option<String>,
    pub column_id: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
}

/// Changes to a card. `None` leaves a field as it is; an empty description
/// clears it.
#[derive(Default)]
pub struct CardPatch {
    pub summary: Option<String>,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub labels: Option<Vec<String>>,
}

fn clean_summary(summary: &str) -> Result<String, String> {
    let summary = summary.trim();
    if summary.is_empty() {
        return Err("A card needs a summary.".to_string());
    }
    Ok(summary.to_string())
}

fn clean_priority(priority: &str) -> Result<String, String> {
    match priority {
        "p0" | "p1" | "p2" | "p3" => Ok(priority.to_string()),
        other => Err(format!(
            "Unknown priority \"{other}\": use p0, p1, p2 or p3."
        )),
    }
}

/// Trimmed, blank ones dropped, each once, in the order given.
fn clean_labels(labels: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for label in labels {
        let label = label.trim().to_string();
        if !label.is_empty() && !out.contains(&label) {
            out.push(label);
        }
    }
    out
}

fn clean_description(description: Option<String>) -> Option<String> {
    description.filter(|d| !d.trim().is_empty())
}

/// The board holding `key`, mutably, and the card's index on it.
fn locate<'a>(file: &'a mut BoardsFile, key: &str) -> Result<(&'a mut Board, usize), String> {
    file.boards
        .iter_mut()
        .find_map(|b| {
            let at = b.cards.iter().position(|c| c.key == key)?;
            Some((b, at))
        })
        .ok_or_else(|| no_card(key))
}

fn no_card(key: &str) -> String {
    format!("There's no card {key}. It may have been deleted.")
}

/// Add a card at the end of its column and give it the next key. The counter is
/// shared by every board and only goes up, so no two cards ever share a key.
pub fn create_card(
    file: &mut BoardsFile,
    board_id: &str,
    card: NewCard,
    created: String,
) -> Result<Card, String> {
    let summary = clean_summary(&card.summary)?;
    let priority = clean_priority(card.priority.as_deref().unwrap_or(DEFAULT_PRIORITY))?;
    let number = file.last_number + 1;
    let board = board_mut(file, board_id)?;
    let column = match card.column_id {
        Some(id) => board
            .column(&id)
            .map(|c| c.id.clone())
            .ok_or_else(|| format!("Board \"{}\" has no column {id}.", board.name))?,
        None => board
            .columns
            .first()
            .map(|c| c.id.clone())
            .ok_or_else(|| format!("Board \"{}\" has no columns.", board.name))?,
    };
    let card = Card {
        key: format!("{KEY_PREFIX}{number}"),
        summary,
        description: clean_description(card.description),
        priority,
        labels: clean_labels(card.labels.unwrap_or_default()),
        column,
        comments: Vec::new(),
        created,
    };
    board.cards.push(card.clone());
    file.last_number = number;
    Ok(card)
}

pub fn update_card(file: &mut BoardsFile, key: &str, patch: CardPatch) -> Result<Card, String> {
    let summary = patch.summary.as_deref().map(clean_summary).transpose()?;
    let priority = patch.priority.as_deref().map(clean_priority).transpose()?;
    let (board, at) = locate(file, key)?;
    let card = &mut board.cards[at];
    if let Some(summary) = summary {
        card.summary = summary;
    }
    if let Some(description) = patch.description {
        card.description = clean_description(Some(description));
    }
    if let Some(priority) = priority {
        card.priority = priority;
    }
    if let Some(labels) = patch.labels {
        card.labels = clean_labels(labels);
    }
    Ok(card.clone())
}

/// Remove a card, refused while its agent runs. Its worktree and conversation are
/// left alone: they may hold work not yet pushed. Its key is never reused.
pub fn delete_card(
    file: &mut BoardsFile,
    key: &str,
    is_running: impl Fn(&str) -> bool,
) -> Result<(), String> {
    if is_running(key) {
        return Err(format!(
            "The agent for {key} is running. Stop it before deleting the card."
        ));
    }
    let (board, at) = locate(file, key)?;
    board.cards.remove(at);
    Ok(())
}

/// Move a card to the column of the first of `target_status_ids` on its board (a
/// column is one status, so the ids are column ids), at the end of that column.
/// Already there: nothing moves.
pub fn transition(
    file: &mut BoardsFile,
    key: &str,
    target_status_ids: &[String],
) -> Result<(), String> {
    let (board, at) = locate(file, key)?;
    let target = target_status_ids
        .iter()
        .find(|id| board.column(id).is_some())
        .cloned()
        .ok_or_else(|| format!("Board \"{}\" has no column to move {key} to.", board.name))?;
    if board.cards[at].column == target {
        return Ok(());
    }
    let mut card = board.cards.remove(at);
    card.column = target;
    board.cards.push(card);
    Ok(())
}

pub fn add_comment(
    file: &mut BoardsFile,
    key: &str,
    author: &str,
    created: String,
    body: &str,
) -> Result<(), String> {
    let body = body.trim();
    if body.is_empty() {
        return Err("A comment can't be empty.".to_string());
    }
    let (board, at) = locate(file, key)?;
    board.cards[at].comments.push(Comment {
        author: author.to_string(),
        created,
        body: body.to_string(),
    });
    Ok(())
}

#[cfg(test)]
#[path = "cards_tests.rs"]
mod tests;
