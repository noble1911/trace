//! A new board made from a template: its columns and card types come from the
//! "New board…" dialog (Software, Research, Bug triage… as data in the frontend's
//! `domains/boards/templates.ts`) instead of the default To do / In progress / Done.

use serde::Deserialize;

use super::edit::clean_name;
use super::model::{fresh_id, Board, BoardsFile, Category, Column};
use super::types::{clean_type_name, clean_type_prompt, CardType};

/// What a template gives a new board, as the frontend sends it.
#[derive(Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardTemplate {
    #[serde(default)]
    pub columns: Vec<TemplateColumn>,
    #[serde(default)]
    pub card_types: Vec<TemplateType>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TemplateColumn {
    pub name: String,
    /// `new` | `indeterminate` | `done`.
    pub category: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct TemplateType {
    pub name: String,
    #[serde(default)]
    pub prompt: Option<String>,
}

/// The board `template` describes, every part checked as if added one by one:
/// at least one column, known categories, type names clean and distinct. Column
/// and type ids are fresh short ones.
pub fn board_from(id: String, name: &str, template: BoardTemplate) -> Result<Board, String> {
    let name = clean_name(name, "A board")?;
    if template.columns.is_empty() {
        return Err("A board needs at least one column.".to_string());
    }
    let mut columns: Vec<Column> = Vec::new();
    for column in template.columns {
        let category = Category::parse(&column.category)?;
        let name = clean_name(&column.name, "A column")?;
        let id = fresh_id(|id| columns.iter().any(|c| c.id == id));
        columns.push(Column { id, name, category });
    }
    let mut card_types: Vec<CardType> = Vec::new();
    for card_type in template.card_types {
        let name = clean_type_name(&card_types, &card_type.name, None)?;
        let prompt = clean_type_prompt(card_type.prompt)?;
        let id = fresh_id(|id| card_types.iter().any(|t| t.id == id));
        card_types.push(CardType { id, name, prompt });
    }
    Ok(Board {
        id,
        name,
        columns,
        cards: Vec::new(),
        card_types,
    })
}

/// Add a board made from `template`. `id` must be new.
pub fn create_board(
    file: &mut BoardsFile,
    id: String,
    name: &str,
    template: BoardTemplate,
) -> Result<Board, String> {
    if file.board(&id).is_some() {
        return Err(format!("A board with id {id} already exists."));
    }
    let board = board_from(id, name, template)?;
    file.boards.push(board.clone());
    Ok(board)
}
