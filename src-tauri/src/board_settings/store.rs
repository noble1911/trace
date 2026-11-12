//! `board-settings.json` in the app config dir, through `helpers::persist`
//! (atomic `0600` writes, locked read-modify-writes). Only boards with something
//! set have an entry: saving the defaults removes it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{without_repo, BoardSettings};
use crate::helpers::persist::{self, Style};

/// The whole file: board key (`provider:boardId`) → its settings.
#[derive(Serialize, Deserialize, Default)]
struct SettingsFile {
    #[serde(default)]
    boards: BTreeMap<String, BoardSettings>,
}

/// Where the settings live.
pub fn default_path() -> PathBuf {
    crate::helpers::trace_dir().join("board-settings.json")
}

/// A board's settings: the defaults when none were saved.
pub fn get(path: &Path, key: &str) -> Result<BoardSettings, String> {
    let file: SettingsFile = persist::read_or_default(path)?;
    Ok(file.boards.get(key).cloned().unwrap_or_default())
}

/// Save a board's (already validated) settings; the defaults remove its entry.
pub fn set(path: &Path, key: &str, settings: BoardSettings) -> Result<BoardSettings, String> {
    persist::update(path, Style::Pretty, |file: &mut SettingsFile| {
        if settings.is_default() {
            file.boards.remove(key);
        } else {
            file.boards.insert(key.to_string(), settings.clone());
        }
    })?;
    Ok(settings)
}

/// Forget a board's settings (a custom board was deleted). No-op without any.
pub fn remove(path: &Path, key: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    persist::update(path, Style::Pretty, |file: &mut SettingsFile| {
        file.boards.remove(key);
    })
}

/// Drop `repo` from every board's settings (it was removed from trace), and any
/// entry that leaves at its defaults.
pub fn drop_repo(path: &Path, repo: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    persist::update(path, Style::Pretty, |file: &mut SettingsFile| {
        let boards = std::mem::take(&mut file.boards);
        file.boards = boards
            .into_iter()
            .map(|(key, s)| (key, without_repo(s, repo)))
            .filter(|(_, s)| !s.is_default())
            .collect();
    })
}
