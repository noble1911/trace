//! Custom boards in the shapes every tracker's board takes (`issues::models`),
//! so the Board page, the ticket view and agent tools need nothing of their own.

use serde::Serialize;

use super::model::{Board, Card};
use super::types::{self, CardType};
use crate::issues::models::{
    initial_of, Assignee, BoardColumn, BoardData, BoardSummary, ColumnStatus, Issue, IssueComment,
    IssueUser,
};

/// The local user's id. Stable, so the board's assignee filter (which defaults to
/// the current user) keeps finding custom cards.
pub const LOCAL_USER_ID: &str = "local";
/// What the local user is called: on cards, as a comment's author.
pub const LOCAL_USER_NAME: &str = "You";

/// The board's `boardType`.
pub const BOARD_TYPE: &str = "custom";

/// The only user of a custom board: whoever runs trace.
pub fn local_user() -> IssueUser {
    IssueUser {
        account_id: LOCAL_USER_ID.to_string(),
        display_name: LOCAL_USER_NAME.to_string(),
        email: None,
        avatar_url: None,
    }
}

fn local_assignee() -> Assignee {
    Assignee {
        account_id: LOCAL_USER_ID.to_string(),
        display_name: LOCAL_USER_NAME.to_string(),
        initial: initial_of(LOCAL_USER_NAME),
        avatar_url: None,
    }
}

pub fn summary(board: &Board) -> BoardSummary {
    BoardSummary {
        id: board.id.clone(),
        name: board.name.clone(),
        board_type: BOARD_TYPE.to_string(),
    }
}

/// Columns in order, each its one status, and every card.
pub fn board_data(board: &Board) -> BoardData {
    let columns = board
        .columns
        .iter()
        .map(|c| BoardColumn {
            name: c.name.clone(),
            statuses: vec![ColumnStatus {
                id: c.id.clone(),
                name: c.name.clone(),
                category: c.category.as_str().to_string(),
            }],
        })
        .collect();
    BoardData {
        board_id: board.id.clone(),
        board_name: board.name.clone(),
        sprint_name: None,
        columns,
        issues: board.cards.iter().map(|c| issue(board, c)).collect(),
    }
}

/// One card as an `Issue`. Its id is its key: there's no other id to look it up
/// by. A card whose column is somehow gone reads as in the first column.
pub fn issue(board: &Board, card: &Card) -> Issue {
    let column = board.column(&card.column).or(board.columns.first());
    let (status_id, status_name, category) = match column {
        Some(c) => (c.id.clone(), c.name.clone(), c.category.as_str()),
        None => (card.column.clone(), card.column.clone(), "new"),
    };
    Issue {
        id: card.key.clone(),
        key: card.key.clone(),
        summary: card.summary.clone(),
        status_id,
        status_name,
        status_category: category.to_string(),
        priority: card.priority.clone(),
        issue_type: types::type_name(board, card),
        labels: card.labels.clone(),
        assignee: Some(local_assignee()),
        description: card.description.clone(),
        epic: None,
        epic_key: None,
        epic_color: None,
        reporter: Some(LOCAL_USER_NAME.to_string()),
        browse_url: None,
    }
}

/// The card's comments, oldest first, as the agent brief reads them.
pub fn comments(card: &Card) -> Vec<IssueComment> {
    card.comments
        .iter()
        .map(|c| IssueComment {
            author: c.author.clone(),
            created: Some(c.created.clone()),
            is_internal: false,
            body: c.body.clone(),
        })
        .collect()
}

/// A custom board's setup beyond its columns (`custom_board_config`): its card types.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardConfig {
    pub id: String,
    pub name: String,
    pub card_types: Vec<CardType>,
}

pub fn config(board: &Board) -> BoardConfig {
    BoardConfig {
        id: board.id.clone(),
        name: board.name.clone(),
        card_types: board.card_types.clone(),
    }
}
