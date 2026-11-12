//! Card types on a custom board: kinds of card (Feature, Bug, Spike…), each with
//! an optional brief that replaces the board's for its cards. Pure mutations over
//! `BoardsFile`, like `edit` and `cards`.
//!
//! A card's type reaches the frontend only as `Issue.issueType`, the type's name,
//! and the UI matches it back by name. So names are unique per board
//! (case-insensitively), and "Task", what a card with no type reads as, is refused.

use serde::{Deserialize, Serialize};

use super::edit::{board_mut, clean_name};
use super::model::{Board, BoardsFile, Card};
use crate::board_settings::clean_prompt;

/// What a card with no type (or whose type was deleted) reads as.
pub const UNTYPED_NAME: &str = "Task";

/// `move_cards_to` meaning "leave the deleted type's cards with no type".
pub const NO_TYPE: &str = "";

/// A kind of card on one board.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CardType {
    /// Short random, like a column's; what cards carry as `typeId`.
    pub id: String,
    pub name: String,
    /// Replaces the board's brief for these cards; `None` uses the board's.
    #[serde(default)]
    pub prompt: Option<String>,
}

/// The name of the card's type, or "Task" when it has none or the type is gone.
pub fn type_name(board: &Board, card: &Card) -> String {
    card.type_id
        .as_deref()
        .and_then(|id| board.card_type(id))
        .map(|t| t.name.clone())
        .unwrap_or_else(|| UNTYPED_NAME.to_string())
}

/// A type name as kept: cleaned like a column's, never "Task", and no other type on
/// `types` (other than `except`, the one being renamed) called the same, in any case.
pub fn clean_type_name(
    types: &[CardType],
    name: &str,
    except: Option<&str>,
) -> Result<String, String> {
    let name = clean_name(name, "A card type")?;
    let lower = name.to_lowercase();
    if lower == UNTYPED_NAME.to_lowercase() {
        return Err(format!(
            "\"{UNTYPED_NAME}\" is what a card with no type shows as; choose another name."
        ));
    }
    if types
        .iter()
        .any(|t| Some(t.id.as_str()) != except && t.name.to_lowercase() == lower)
    {
        return Err(format!("There's already a card type called \"{name}\"."));
    }
    Ok(name)
}

/// A type's brief as kept: trimmed, empty is none, capped like a board's.
pub fn clean_type_prompt(prompt: Option<String>) -> Result<Option<String>, String> {
    clean_prompt(prompt, "A card type")
}

fn type_index(board: &Board, type_id: &str) -> Result<usize, String> {
    board
        .card_types
        .iter()
        .position(|t| t.id == type_id)
        .ok_or_else(|| format!("Board \"{}\" has no card type {type_id}.", board.name))
}

/// The type id a card is given: `Some("")` is no type, `Some(id)` must be one of
/// the board's types. For create and update alike; `None` is handled by the caller
/// (create: the first type; update: unchanged).
pub fn resolve_type_id(board: &Board, type_id: &str) -> Result<Option<String>, String> {
    if type_id == NO_TYPE {
        return Ok(None);
    }
    type_index(board, type_id)?;
    Ok(Some(type_id.to_string()))
}

/// Add a type at the end. `id` must be new on the board.
pub fn add_type(
    file: &mut BoardsFile,
    board_id: &str,
    id: String,
    name: &str,
    prompt: Option<String>,
) -> Result<(), String> {
    let prompt = clean_type_prompt(prompt)?;
    let board = board_mut(file, board_id)?;
    let name = clean_type_name(&board.card_types, name, None)?;
    if board.card_type(&id).is_some() {
        return Err(format!(
            "Board \"{}\" already has a card type {id}.",
            board.name
        ));
    }
    board.card_types.push(CardType { id, name, prompt });
    Ok(())
}

/// Rename a type and/or set its brief. `None` leaves that part; an empty prompt
/// clears it, so the board's brief applies.
pub fn update_type(
    file: &mut BoardsFile,
    board_id: &str,
    type_id: &str,
    name: Option<&str>,
    prompt: Option<String>,
) -> Result<(), String> {
    let board = board_mut(file, board_id)?;
    let at = type_index(board, type_id)?;
    let name = name
        .map(|n| clean_type_name(&board.card_types, n, Some(type_id)))
        .transpose()?;
    let prompt = prompt.map(|p| clean_type_prompt(Some(p))).transpose()?;
    let card_type = &mut board.card_types[at];
    if let Some(name) = name {
        card_type.name = name;
    }
    if let Some(prompt) = prompt {
        card_type.prompt = prompt;
    }
    Ok(())
}

/// Delete a type. Its cards go to `move_cards_to`: another type's id, or `""`
/// (`NO_TYPE`) to leave them untyped. With cards and no target it's refused.
pub fn delete_type(
    file: &mut BoardsFile,
    board_id: &str,
    type_id: &str,
    move_cards_to: Option<&str>,
) -> Result<(), String> {
    let board = board_mut(file, board_id)?;
    let at = type_index(board, type_id)?;
    let has_cards = board
        .cards
        .iter()
        .any(|c| c.type_id.as_deref() == Some(type_id));
    let target = match move_cards_to {
        Some(target) if target == type_id => {
            return Err("Move the cards to a different type.".to_string());
        }
        Some(target) => resolve_type_id(board, target)?,
        None if has_cards => {
            return Err(format!(
                "Card type \"{}\" has cards. Choose a type to give them first.",
                board.card_types[at].name
            ));
        }
        None => None,
    };
    for card in board
        .cards
        .iter_mut()
        .filter(|c| c.type_id.as_deref() == Some(type_id))
    {
        card.type_id = target.clone();
    }
    board.card_types.remove(at);
    Ok(())
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
