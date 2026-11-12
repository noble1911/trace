//! The `local-<n>` counter, in a file of its own (`custom-card-counter.json`,
//! beside `custom-boards.json`, through `helpers::persist`).
//!
//! A card's key names its worktree, branch, repo assignment and conversation,
//! all of which outlive the card. So a number must never be handed out twice,
//! even if `custom-boards.json` is lost: a corrupt file is moved aside and
//! starts empty, and a removed one is simply gone, and a counter kept inside it
//! would start again at 1, giving a new card an old card's worktree. Kept apart,
//! it survives that. Each number handed out is above the counter, the boards
//! file's own `lastNumber` (what trace kept before this file, and what an older
//! trace still keeps) and every card key on it, and skips any key this machine
//! already has a repo assignment or worktree for.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::model::{BoardsFile, KEY_PREFIX};
use crate::helpers::persist::{self, Style};

/// Keys skipped in a row before giving up: only a broken `is_taken` gets here.
const MAX_SKIPS: u64 = 10_000;

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Counter {
    /// The number the last card was given.
    #[serde(default)]
    last: u64,
}

/// The counter's file, beside the boards file at `boards`.
pub fn path_beside(boards: &Path) -> PathBuf {
    boards.with_file_name("custom-card-counter.json")
}

/// The key for card number `n`.
pub fn key(n: u64) -> String {
    format!("{KEY_PREFIX}{n}")
}

/// The highest number the boards file has used: its `lastNumber` and its cards'.
pub fn floor_of(file: &BoardsFile) -> u64 {
    let cards = file.boards.iter().flat_map(|b| b.cards.iter());
    let numbers = cards.filter_map(|c| c.key.strip_prefix(KEY_PREFIX)?.parse::<u64>().ok());
    numbers.fold(file.last_number, u64::max)
}

/// The first number above `after` whose key isn't taken.
pub fn next_free(after: u64, is_taken: impl Fn(&str) -> bool) -> Result<u64, String> {
    (after + 1..=after + MAX_SKIPS)
        .find(|n| !is_taken(&key(*n)))
        .ok_or_else(|| "Couldn't find a free key for a new card.".to_string())
}

/// Hand out the next number, above `floor` (the boards file's [`floor_of`])
/// and the counter, skipping keys `is_taken`. Under the counter file's lock,
/// so two windows never get the same one. A number handed out for a card that
/// then fails to be made is simply never used.
pub fn reserve(path: &Path, floor: u64, is_taken: impl Fn(&str) -> bool) -> Result<u64, String> {
    persist::update(path, Style::Pretty, |c: &mut Counter| {
        let n = next_free(c.last.max(floor), &is_taken)?;
        c.last = n;
        Ok(n)
    })?
}

/// Whether this machine already has something under `key`: a repo assignment
/// or a worktree directory in any configured repo. Read once per card made.
pub fn taken_here() -> impl Fn(&str) -> bool {
    use crate::commands::repos;
    let assigned: Vec<String> = repos::assigned_workspaces()
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    let repos = repos::all_repos();
    move |key: &str| {
        assigned.iter().any(|a| a == key)
            || repos
                .iter()
                .any(|r| Path::new(&repos::workspace_dir(r, key)).exists())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_counter_outlives_the_boards_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let counter = path_beside(&dir.path().join("custom-boards.json"));
        assert_eq!(reserve(&counter, 0, |_| false), Ok(1));
        assert_eq!(reserve(&counter, 0, |_| false), Ok(2));
        // The boards file is gone (floor 0): the counter carries on.
        assert_eq!(reserve(&counter, 0, |_| false), Ok(3));
    }

    #[test]
    fn an_existing_last_number_is_migrated_and_taken_keys_skipped() {
        let dir = tempfile::tempdir().expect("tempdir");
        let counter = dir.path().join("custom-card-counter.json");
        let taken = |k: &str| k == "local-8" || k == "local-9";
        assert_eq!(reserve(&counter, 7, taken), Ok(10));
        assert_eq!(
            reserve(&counter, 2, |_| false),
            Ok(11),
            "a lower floor changes nothing"
        );
    }

    #[test]
    fn the_floor_is_the_files_counter_or_its_highest_card() {
        let raw = serde_json::json!({
            "boards": [{ "id": "b", "name": "B",
                "columns": [{ "id": "todo", "name": "To do", "category": "new" }],
                "cards": [{ "key": "local-12", "summary": "S", "priority": "p2",
                            "column": "todo", "created": "t" }] }],
            "lastNumber": 4
        });
        let file: BoardsFile = serde_json::from_value(raw).expect("file");
        assert_eq!(floor_of(&file), 12);
        assert_eq!(floor_of(&BoardsFile::default()), 0);
    }

    #[test]
    fn a_broken_taken_check_doesnt_spin_forever() {
        assert!(next_free(0, |_| true).is_err());
    }
}
