//! The skill sources the user added, in `skill-sources.json` (`0600`, through
//! `helpers::persist`). Only the list: what each source holds is read from
//! GitHub, and what's installed from Claude Code and the projects, every time,
//! so trace never keeps a stale copy of either.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::helpers::persist::{self, Style};

/// More sources than anyone adds; a guard against a runaway file.
const MAX_SOURCES: usize = 100;

/// One added source.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecord {
    /// `owner/name` on GitHub, as GitHub spells it.
    pub repo: String,
    /// Epoch ms.
    pub added_at: u64,
    /// Keep what's installed from it up to date by itself (stage 2 acts on it).
    #[serde(default)]
    pub auto_update: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct File {
    #[serde(default)]
    sources: Vec<SourceRecord>,
}

fn path() -> PathBuf {
    crate::helpers::trace_dir().join("skill-sources.json")
}

fn same(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// The sources, in the order they were added.
pub fn list() -> Vec<SourceRecord> {
    persist::read_or_log::<File>(&path()).sources
}

/// Add `repo`, or keep it where it is if it's there already (GitHub names are
/// case-insensitive). Returns the list.
pub fn add(repo: &str, now_ms: u64) -> Result<Vec<SourceRecord>, String> {
    persist::update(&path(), Style::Pretty, |f: &mut File| {
        if !f.sources.iter().any(|s| same(&s.repo, repo)) {
            if f.sources.len() >= MAX_SOURCES {
                return Err(format!("trace keeps at most {MAX_SOURCES} skill sources."));
            }
            f.sources.push(SourceRecord {
                repo: repo.to_string(),
                added_at: now_ms,
                auto_update: false,
            });
        }
        Ok(f.sources.clone())
    })?
}

/// Forget `repo` as a source. What was installed from it stays installed.
pub fn remove(repo: &str) -> Result<Vec<SourceRecord>, String> {
    persist::update(&path(), Style::Pretty, |f: &mut File| {
        f.sources.retain(|s| !same(&s.repo, repo));
        f.sources.clone()
    })
}
