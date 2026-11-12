//! What `custom-boards.json` holds: every board the user made in trace, with its
//! columns and cards. Plain serde shapes, so the file stays readable JSON and the
//! mutations (`edit`, `cards`) are pure functions over them.

use serde::{Deserialize, Serialize};

use super::types::CardType;

/// Every card key starts with this. Lowercase on purpose: a Jira key is
/// `ABC-123` and a Pylon one `#123`, so a key alone says which tracker owns it.
pub const KEY_PREFIX: &str = "local-";

/// A new card's priority when none is given (the middle of p0..p3).
pub const DEFAULT_PRIORITY: &str = "p2";

/// Whether `key` is a custom-board card key (`local-<digits>`). Lets callers that
/// hold only a workspace id (activity, cleanup, the agent's context) route it.
pub fn is_card_key(key: &str) -> bool {
    key.strip_prefix(KEY_PREFIX)
        .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// A column's status category, so auto-start and cleanup work from what a column
/// *means* rather than what it's called. Serialized like every tracker's.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    New,
    Indeterminate,
    Done,
}

impl Category {
    /// From the IPC string (`new` | `indeterminate` | `done`).
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "new" => Ok(Category::New),
            "indeterminate" => Ok(Category::Indeterminate),
            "done" => Ok(Category::Done),
            other => Err(format!(
                "Unknown column category \"{other}\": use new, indeterminate or done."
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Category::New => "new",
            Category::Indeterminate => "indeterminate",
            Category::Done => "done",
        }
    }
}

/// The whole file.
#[derive(Serialize, Deserialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BoardsFile {
    #[serde(default)]
    pub boards: Vec<Board>,
    /// The number the last card was given, across every board. Only ever goes up,
    /// so a deleted card's key (and the worktree and conversation named after it)
    /// is never handed to a new card.
    #[serde(default)]
    pub last_number: u64,
}

/// One board. Its columns are its statuses, in board order.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub cards: Vec<Card>,
    /// Kinds of card, in the order the board lists them (`types`). Defaulted so
    /// files from before types load as boards without any.
    #[serde(default)]
    pub card_types: Vec<CardType>,
}

/// A column is exactly one status: its id is the status id cards carry.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub id: String,
    pub name: String,
    pub category: Category,
}

/// A card, in board order (within its column, cards keep the order they're in here).
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    /// `local-<n>`; also the card's agent's workspace id.
    pub key: String,
    pub summary: String,
    #[serde(default)]
    pub description: Option<String>,
    /// `p0`..`p3`.
    pub priority: String,
    #[serde(default)]
    pub labels: Vec<String>,
    /// The id of the column it's in.
    pub column: String,
    #[serde(default)]
    pub comments: Vec<Comment>,
    /// One of its board's card types; `None` (or a type since deleted) is "Task".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub type_id: Option<String>,
    /// ISO-8601, when it was made.
    pub created: String,
}

/// A comment, stored with its card (there's no tracker to post it to).
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub author: String,
    /// ISO-8601.
    pub created: String,
    pub body: String,
}

impl Board {
    /// A new board with trace's starting columns: To do / In progress / Done.
    pub fn new(id: String, name: String) -> Self {
        let column = |id: &str, name: &str, category| Column {
            id: id.to_string(),
            name: name.to_string(),
            category,
        };
        Board {
            id,
            name,
            columns: vec![
                column("todo", "To do", Category::New),
                column("in-progress", "In progress", Category::Indeterminate),
                column("done", "Done", Category::Done),
            ],
            cards: Vec::new(),
            card_types: Vec::new(),
        }
    }

    pub fn column(&self, id: &str) -> Option<&Column> {
        self.columns.iter().find(|c| c.id == id)
    }

    pub fn card_type(&self, id: &str) -> Option<&CardType> {
        self.card_types.iter().find(|t| t.id == id)
    }
}

impl BoardsFile {
    pub fn board(&self, id: &str) -> Option<&Board> {
        self.boards.iter().find(|b| b.id == id)
    }

    /// The card with `key` and the board it's on.
    pub fn find_card(&self, key: &str) -> Option<(&Board, &Card)> {
        self.boards
            .iter()
            .find_map(|b| b.cards.iter().find(|c| c.key == key).map(|c| (b, c)))
    }
}

/// A short id no existing one matches (`taken`), for a new board or column. Eight
/// hex chars: readable in `custom:<id>` and agent tool output, and a clash is
/// retried rather than trusted to luck.
pub fn fresh_id(mut taken: impl FnMut(&str) -> bool) -> String {
    loop {
        let mut id = uuid::Uuid::new_v4().simple().to_string();
        id.truncate(8);
        if !taken(&id) {
            return id;
        }
    }
}

/// Now, as the ISO-8601 timestamp cards and comments carry.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn card_keys_are_lowercase_local_and_digits() {
        assert!(is_card_key("local-1"));
        assert!(is_card_key("local-120"));
        assert!(!is_card_key("local-"));
        assert!(!is_card_key("LOCAL-1"));
        assert!(!is_card_key("local-1a"));
        assert!(!is_card_key("TRACE-12"));
        assert!(!is_card_key("#12"));
    }

    #[test]
    fn categories_round_trip() {
        for c in [Category::New, Category::Indeterminate, Category::Done] {
            assert_eq!(Category::parse(c.as_str()), Ok(c));
        }
        assert!(Category::parse("todo").is_err());
    }

    #[test]
    fn fresh_ids_skip_taken_ones() {
        let id = fresh_id(|_| false);
        assert_eq!(id.len(), 8);
        let mut tries = 0;
        let other = fresh_id(|_| {
            tries += 1;
            tries < 3
        });
        assert_eq!(other.len(), 8);
    }
}
