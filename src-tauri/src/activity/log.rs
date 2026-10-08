//! JSONL persistence for the activity log (`activity.jsonl` in the config dir).
//!
//! Append-only so a write is one `write` call no matter how long the log is; the
//! newest [`CAP`] events are cached in memory and the file is compacted back to
//! them once it has grown to twice that. Lines that don't parse (a torn write
//! from a crash) are skipped, never fatal.

use std::collections::VecDeque;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;

use parking_lot::{const_mutex, Mutex};

use super::model::ActivityEvent;
use crate::helpers::{restrict_perms, trace_dir};

/// Events kept. Enough for days of history in the feed and for any consumer's
/// "since you were last here" catch-up; small enough to load instantly.
const CAP: usize = 1000;

struct Log {
    path: PathBuf,
    /// Oldest first.
    events: VecDeque<ActivityEvent>,
    /// Lines in the file, including ones already evicted from `events`.
    lines: usize,
}

impl Log {
    fn open(path: PathBuf) -> Self {
        let text = fs::read_to_string(&path).unwrap_or_default();
        let lines = text.lines().filter(|l| !l.trim().is_empty()).count();
        let mut events: VecDeque<ActivityEvent> = text
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        while events.len() > CAP {
            events.pop_front();
        }
        Self {
            path,
            events,
            lines,
        }
    }

    fn append(&mut self, event: &ActivityEvent) -> io::Result<()> {
        let line = serde_json::to_string(event).map_err(io::Error::other)?;
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{line}")?;
        restrict_perms(&self.path);
        self.lines += 1;
        self.events.push_back(event.clone());
        if self.events.len() > CAP {
            self.events.pop_front();
        }
        if self.lines >= CAP * 2 {
            self.compact()?;
        }
        Ok(())
    }

    /// Rewrite the file to exactly the cached events (atomically, via rename).
    fn compact(&mut self) -> io::Result<()> {
        let mut out = String::new();
        for e in &self.events {
            out.push_str(&serde_json::to_string(e).map_err(io::Error::other)?);
            out.push('\n');
        }
        let tmp = self.path.with_extension("jsonl.tmp");
        fs::write(&tmp, out)?;
        restrict_perms(&tmp);
        fs::rename(&tmp, &self.path)?;
        self.lines = self.events.len();
        Ok(())
    }

    fn newest_first(&self, limit: usize) -> Vec<ActivityEvent> {
        self.events.iter().rev().take(limit).cloned().collect()
    }

    fn clear(&mut self) -> io::Result<()> {
        self.events.clear();
        self.lines = 0;
        match fs::remove_file(&self.path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    /// Seed an empty log (the one-time move off the renderer's localStorage
    /// feed). A no-op once anything has been recorded, so it can't duplicate.
    fn import(&mut self, mut events: Vec<ActivityEvent>) -> io::Result<bool> {
        if !self.events.is_empty() || events.is_empty() {
            return Ok(false);
        }
        events.sort_by_key(|e| e.at);
        let skip = events.len().saturating_sub(CAP);
        self.events = events.into_iter().skip(skip).collect();
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        self.compact()?;
        Ok(true)
    }
}

static LOG: Mutex<Option<Log>> = const_mutex(None);

fn with_log<R>(f: impl FnOnce(&mut Log) -> R) -> R {
    let mut guard = LOG.lock();
    let log = guard.get_or_insert_with(|| Log::open(log_path()));
    f(log)
}

fn log_path() -> PathBuf {
    trace_dir().join("activity.jsonl")
}

/// Persist one event.
pub fn append(event: &ActivityEvent) -> io::Result<()> {
    with_log(|log| log.append(event))
}

/// Up to `limit` events, newest first.
pub fn list(limit: usize) -> Vec<ActivityEvent> {
    with_log(|log| log.newest_first(limit))
}

/// Drop every event.
pub fn clear() -> io::Result<()> {
    with_log(Log::clear)
}

/// Seed an empty log; `false` if it already had events.
pub fn import(events: Vec<ActivityEvent>) -> io::Result<bool> {
    with_log(|log| log.import(events))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::model::{ActivityInput, ActivityKind, Actor};

    fn test_path(name: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("trace-activity-{}", crate::helpers::new_id()))
            .join(name)
    }

    fn event(title: &str) -> ActivityEvent {
        ActivityEvent::stamp(ActivityInput::new(
            ActivityKind::Transition,
            Actor::User,
            title,
        ))
    }

    #[test]
    fn appends_survive_reopen_newest_first() {
        let path = test_path("a.jsonl");
        let mut log = Log::open(path.clone());
        log.append(&event("one")).unwrap();
        log.append(&event("two")).unwrap();
        let reopened = Log::open(path);
        let titles: Vec<_> = reopened.newest_first(10).into_iter().map(|e| e.title).collect();
        assert_eq!(titles, ["two", "one"]);
    }

    #[test]
    fn compacts_to_cap() {
        let path = test_path("b.jsonl");
        let mut log = Log::open(path.clone());
        for i in 0..CAP * 2 {
            log.append(&event(&i.to_string())).unwrap();
        }
        assert_eq!(log.lines, CAP);
        let reopened = Log::open(path);
        assert_eq!(reopened.events.len(), CAP);
        assert_eq!(reopened.newest_first(1)[0].title, (CAP * 2 - 1).to_string());
    }

    #[test]
    fn skips_torn_lines() {
        let path = test_path("c.jsonl");
        let mut log = Log::open(path.clone());
        log.append(&event("ok")).unwrap();
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{{\"id\":\"torn").unwrap();
        assert_eq!(Log::open(path).events.len(), 1);
    }

    #[test]
    fn import_only_seeds_an_empty_log() {
        let mut log = Log::open(test_path("d.jsonl"));
        assert!(log.import(vec![event("old")]).unwrap());
        assert!(!log.import(vec![event("again")]).unwrap());
        assert_eq!(log.events.len(), 1);
    }

    #[test]
    fn unknown_kinds_read_as_other() {
        let line = r#"{"id":"x","at":1,"kind":"from-the-future","title":"t"}"#;
        let e: ActivityEvent = serde_json::from_str(line).unwrap();
        assert_eq!(e.kind, ActivityKind::Other);
        assert_eq!(e.actor, Actor::User);
    }
}
