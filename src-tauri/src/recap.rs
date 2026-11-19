//! Each agent's recap: where its work is up to (goal, done, now, next), kept in
//! `recaps.json` so it's there the moment a workspace opens, even after a restart.
//!
//! The renderer writes it (`domains/recap/engine.ts`): when a turn ends it reads the
//! conversation from `offset` on, asks Haiku to update the previous recap, and saves
//! the result with the new offset. This module only stores and validates; it never
//! calls a model. `seen_at` is when the user last opened the workspace, which is what
//! "Since you looked" counts from.
//!
//! Text is clipped on the way in, and the file holds at most [`MAX_RECAPS`] entries
//! (the least recently updated go first), so a long-lived install can't grow it
//! without bound.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::persist::{self, Style};

/// More workspaces than anyone keeps open; the oldest recaps go past this.
pub const MAX_RECAPS: usize = 400;
/// Longest a recap field may be; a model that rambles is cut.
const MAX_FIELD: usize = 400;
const MAX_ID: usize = 200;

/// Where one agent's work is up to, as Haiku last summarised it.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Recap {
    pub goal: String,
    pub done: String,
    pub now: String,
    pub next: String,
    /// When it was written (epoch ms).
    pub at: u64,
    /// The Claude conversation `offset` belongs to; a new one starts reading again.
    pub session_id: Option<String>,
    /// Byte offset into the conversation file this recap covers up to.
    pub offset: u64,
    /// When the user last opened this workspace (epoch ms); 0 = never recorded.
    pub seen_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RecapFile {
    #[serde(default)]
    recaps: BTreeMap<String, Recap>,
}

fn recap_file() -> PathBuf {
    crate::helpers::trace_dir().join("recaps.json")
}

fn clip(s: &str) -> String {
    let s = s.trim();
    match s.char_indices().nth(MAX_FIELD) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// A recap made safe to store: fields trimmed and clipped.
fn clean(r: Recap) -> Recap {
    Recap {
        goal: clip(&r.goal),
        done: clip(&r.done),
        now: clip(&r.now),
        next: clip(&r.next),
        session_id: r.session_id.filter(|s| !s.is_empty() && s.len() <= MAX_ID),
        ..r
    }
}

/// Keep at most `max` recaps, dropping the least recently written or seen.
fn prune(recaps: &mut BTreeMap<String, Recap>, max: usize) {
    if recaps.len() <= max {
        return;
    }
    let mut by_age: Vec<(u64, String)> = recaps
        .iter()
        .map(|(k, r)| (r.at.max(r.seen_at), k.clone()))
        .collect();
    by_age.sort();
    for (_, k) in by_age.into_iter().take(recaps.len() - max) {
        recaps.remove(&k);
    }
}

fn valid_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty() || id.len() > MAX_ID {
        return Err("That workspace has no id.".to_string());
    }
    Ok(id)
}

/// Every saved recap, by workspace id.
pub fn list() -> Result<BTreeMap<String, Recap>, String> {
    let file: RecapFile = persist::read_or_default(&recap_file())?;
    Ok(file.recaps)
}

/// Save a workspace's recap, keeping the `seen_at` already on file (only
/// [`mark_seen`] moves it). Returns it as stored.
pub fn save(workspace_id: &str, recap: Recap) -> Result<Recap, String> {
    let id = valid_id(workspace_id)?.to_string();
    let recap = clean(recap);
    persist::update(&recap_file(), Style::Compact, |file: &mut RecapFile| {
        let seen_at = file.recaps.get(&id).map_or(0, |r| r.seen_at);
        let stored = Recap { seen_at, ..recap };
        file.recaps.insert(id.clone(), stored.clone());
        prune(&mut file.recaps, MAX_RECAPS);
        stored
    })
}

/// Record that the user opened the workspace at `at`. Returns the time it was
/// last seen before this (0 if never), which is what "Since you looked" counts from.
pub fn mark_seen(workspace_id: &str, at: u64) -> Result<u64, String> {
    let id = valid_id(workspace_id)?.to_string();
    persist::update(&recap_file(), Style::Compact, |file: &mut RecapFile| {
        let entry = file.recaps.entry(id).or_default();
        let before = entry.seen_at;
        entry.seen_at = entry.seen_at.max(at);
        prune(&mut file.recaps, MAX_RECAPS);
        before
    })
}

#[cfg(test)]
mod tests {
    use super::{clean, clip, prune, Recap, MAX_FIELD};
    use std::collections::BTreeMap;

    fn at(at: u64, seen_at: u64) -> Recap {
        Recap {
            at,
            seen_at,
            ..Recap::default()
        }
    }

    #[test]
    fn long_fields_are_clipped_on_a_char_boundary() {
        let long = "é".repeat(MAX_FIELD + 10);
        let out = clip(&long);
        assert_eq!(out.chars().count(), MAX_FIELD + 1);
        assert!(out.ends_with('…'));
        assert_eq!(clip("  short  "), "short");
    }

    #[test]
    fn an_empty_session_id_is_dropped() {
        let r = clean(Recap {
            session_id: Some(String::new()),
            ..Recap::default()
        });
        assert_eq!(r.session_id, None);
    }

    #[test]
    fn pruning_drops_the_least_recently_touched() {
        let mut m = BTreeMap::new();
        m.insert("old".to_string(), at(1, 0));
        m.insert("seen".to_string(), at(1, 50));
        m.insert("new".to_string(), at(40, 0));
        prune(&mut m, 2);
        let kept: Vec<&str> = m.keys().map(String::as_str).collect();
        assert_eq!(kept, vec!["new", "seen"]);
    }

    #[test]
    fn a_partial_file_loads() {
        let r: Recap = serde_json::from_str(r#"{"now":"x"}"#).unwrap();
        assert_eq!(r.now, "x");
        assert_eq!(r.offset, 0);
    }
}
