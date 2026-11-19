//! The rows an adapter is still changing, so each change goes out as the next
//! revision of the same row. A row that can't change any more is retired, which
//! keeps a long conversation's memory to what's open.

use std::collections::HashMap;

use crate::agent_session::journal::{JournalBody, JournalRow};

pub struct RowBook {
    next_seq: u64,
    live: HashMap<String, JournalRow>,
    clock: fn() -> u64,
}

impl RowBook {
    /// `next_seq` continues the journal's order; `clock` gives Unix milliseconds.
    pub fn new(next_seq: u64, clock: fn() -> u64) -> Self {
        Self {
            next_seq,
            live: HashMap::new(),
            clock,
        }
    }

    /// Add a row, or replace an open one's body as its next revision.
    pub fn put(&mut self, id: &str, turn_id: Option<&str>, body: JournalBody) -> JournalRow {
        if let Some(row) = self.live.get_mut(id) {
            row.revision += 1;
            row.body = body;
            return row.clone();
        }
        let row = JournalRow {
            id: id.to_string(),
            revision: 0,
            seq: self.next_seq,
            at: (self.clock)(),
            turn_id: turn_id.map(str::to_string),
            body,
        };
        self.next_seq += 1;
        self.live.insert(id.to_string(), row.clone());
        row
    }

    /// Change an open row in place, as its next revision. `None` if it isn't open.
    pub fn update(&mut self, id: &str, f: impl FnOnce(&mut JournalBody)) -> Option<JournalRow> {
        let row = self.live.get_mut(id)?;
        f(&mut row.body);
        row.revision += 1;
        Some(row.clone())
    }

    /// The `seq` the next new row gets: unique within the journal, so it also
    /// names rows that have no id of the agent's own (a status, a user turn).
    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    /// Now, by the book's clock (fixed in tests).
    pub fn now(&self) -> u64 {
        (self.clock)()
    }

    pub fn get(&self, id: &str) -> Option<&JournalRow> {
        self.live.get(id)
    }

    /// Forget a row that won't change again.
    pub fn retire(&mut self, id: &str) {
        self.live.remove(id);
    }

    /// Ids of the open rows whose body matches, oldest first.
    pub fn open_ids(&self, matches: impl Fn(&JournalBody) -> bool) -> Vec<String> {
        let mut rows: Vec<&JournalRow> = self.live.values().filter(|r| matches(&r.body)).collect();
        rows.sort_by_key(|r| r.seq);
        rows.into_iter().map(|r| r.id.clone()).collect()
    }
}

/// Unix milliseconds now.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
