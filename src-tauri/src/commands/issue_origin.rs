//! Who started a ticket's agent. A session carries its `createdBy` on its own record;
//! a ticket has no record of its own, so its creator is kept here, by issue key, in
//! `issue-origins.json` (like `issue_host`). A key with no entry was started by the
//! user, which is also what every start from before this was recorded reads as.
//!
//! The renderer works the creator out as it does a session's (`creatorFromCaller`,
//! from the calling agent's own `X-Trace-Workspace` header, never a tool argument)
//! and records it once the agent has started. Each start replaces the last.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::Value;

use crate::commands::session_origin::CreatedBy;
use crate::helpers::persist::{self, Style};

fn file() -> PathBuf {
    crate::helpers::trace_dir().join("issue-origins.json")
}

/// Kept as raw JSON so one record a newer trace wrote can't sink the others.
type Origins = BTreeMap<String, Value>;

/// Every ticket's creator that isn't the user, for Fleet. A record this build can't
/// read is left out (reads as the user) rather than failing the lot.
#[tauri::command]
pub fn issue_origins() -> BTreeMap<String, CreatedBy> {
    readable(persist::read_or_log::<Origins>(&file()))
}

/// Record who started `issue_key`'s agent: the user clears the entry.
#[tauri::command]
pub fn set_issue_origin(issue_key: String, created_by: CreatedBy) -> Result<(), String> {
    let key = issue_key.trim().to_string();
    if key.is_empty() {
        return Err("No issue key.".into());
    }
    let record = created_by
        .sanitize()
        .map(|cb| serde_json::to_value(cb).map_err(|e| e.to_string()))
        .transpose()?;
    persist::update(&file(), Style::Compact, |all: &mut Origins| match record {
        Some(v) => {
            all.insert(key, v);
        }
        None => {
            all.remove(&key);
        }
    })
}

fn readable(raw: Origins) -> BTreeMap<String, CreatedBy> {
    raw.into_iter()
        .filter_map(|(k, v)| serde_json::from_value(v).ok().map(|cb| (k, cb)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::session_origin::ParentKind;
    use serde_json::json;

    #[test]
    fn an_unknown_record_is_skipped_and_the_rest_still_read() {
        let raw: Origins = [
            ("PM-1".to_string(), json!({ "kind": "orchestrator" })),
            ("PM-2".to_string(), json!({ "kind": "somethingNew", "x": 1 })),
            (
                "PM-3".to_string(),
                json!({ "kind": "agent", "workspaceId": "s1", "parent": "session", "label": "Epic" }),
            ),
        ]
        .into_iter()
        .collect();
        let read = readable(raw);
        assert_eq!(read.len(), 2);
        assert_eq!(read["PM-1"], CreatedBy::Orchestrator);
        assert_eq!(
            read["PM-3"],
            CreatedBy::Agent {
                workspace_id: "s1".into(),
                parent: ParentKind::Session,
                label: "Epic".into(),
            }
        );
    }
}
