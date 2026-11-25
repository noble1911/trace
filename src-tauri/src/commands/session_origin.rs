//! Who started a session: the user (from the New session dialog — also every
//! session saved before this was recorded), an agent through trace's MCP
//! `start_session` tool, the orchestrator, a scheduled prompt (a run calling
//! `start_session`, or "Continue as session" on one of its runs), or another
//! computer: a paired trace that asked this one's peer server for a session.
//!
//! The parent's title or key is copied in when the session is made, so "by …"
//! still reads well after the parent is renamed or deleted. The renderer builds
//! the agent's record from the calling workspace id the MCP server took from the
//! agent's own `X-Trace-Workspace` header (`agent_tools::server`), never from
//! anything the agent passes as a tool argument.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// A label longer than this is cut: it's a one-line "by …" chip.
const MAX_LABEL: usize = 120;

/// What kind of workspace an agent creator ran in.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ParentKind {
    /// A standalone session (or one of its companion agents).
    Session,
    /// A ticket's agent; `workspace_id` is the issue key.
    Ticket,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CreatedBy {
    User,
    #[serde(rename_all = "camelCase")]
    Agent {
        /// The owning session's id, or the issue key: what "open the parent" opens.
        workspace_id: String,
        parent: ParentKind,
        /// The session's title or the ticket's key, as it was then.
        label: String,
    },
    Orchestrator,
    #[serde(rename_all = "camelCase")]
    Schedule {
        prompt_id: String,
        /// The run it came from, when known.
        #[serde(default)]
        run_id: Option<String>,
        /// The prompt's title, as it was then.
        label: String,
    },
    /// Another trace, over the peer server (`execution::peer`). `label` is that
    /// machine's name on the tailnet, looked up by its address here rather than
    /// taken from what it calls itself.
    Peer {
        label: String,
    },
}

/// What a peer with no name reads as.
const UNNAMED_PEER: &str = "another computer";

impl CreatedBy {
    /// What's worth storing: `None` for the user (the default, so records stay as
    /// they always were), trimmed labels, and nothing that names no parent.
    pub fn sanitize(self) -> Option<CreatedBy> {
        let clip = |s: String| -> String {
            let t = s.trim();
            t.chars().take(MAX_LABEL).collect()
        };
        match self {
            CreatedBy::User => None,
            CreatedBy::Orchestrator => Some(CreatedBy::Orchestrator),
            CreatedBy::Peer { label } => {
                let label = clip(label);
                Some(CreatedBy::Peer {
                    label: if label.is_empty() {
                        UNNAMED_PEER.to_string()
                    } else {
                        label
                    },
                })
            }
            CreatedBy::Agent {
                workspace_id,
                parent,
                label,
            } => {
                let workspace_id = workspace_id.trim().to_string();
                if workspace_id.is_empty() {
                    return None;
                }
                let label = clip(label);
                Some(CreatedBy::Agent {
                    label: if label.is_empty() {
                        workspace_id.clone()
                    } else {
                        label
                    },
                    workspace_id,
                    parent,
                })
            }
            CreatedBy::Schedule {
                prompt_id,
                run_id,
                label,
            } => {
                let prompt_id = prompt_id.trim().to_string();
                if prompt_id.is_empty() {
                    return None;
                }
                let label = clip(label);
                Some(CreatedBy::Schedule {
                    prompt_id,
                    run_id: run_id.filter(|r| !r.trim().is_empty()),
                    label: if label.is_empty() {
                        "Scheduled prompt".to_string()
                    } else {
                        label
                    },
                })
            }
        }
    }
}

/// Read `createdBy` without letting it sink the file: a kind this build doesn't
/// know (written by a newer trace) or a malformed record reads as the user, rather
/// than failing to load every session.
pub fn lenient<'de, D: Deserializer<'de>>(d: D) -> Result<Option<CreatedBy>, D::Error> {
    let raw = Option::<Value>::deserialize(d)?;
    Ok(raw.and_then(|v| serde_json::from_value::<CreatedBy>(v).ok()))
}

#[cfg(test)]
mod tests {
    use super::{CreatedBy, ParentKind};
    use crate::commands::session::ScratchSession;
    use serde_json::json;

    fn old_record() -> serde_json::Value {
        json!({
            "id": "s1", "title": "Spike", "cli": "claude", "createdAt": 1_700_000_000u64,
            "tab": null, "section": null, "worktree": true, "repo": "C:\\src\\trace"
        })
    }

    #[test]
    fn an_old_session_loads_as_started_by_the_user_and_saves_unchanged() {
        let s: ScratchSession = serde_json::from_value(old_record()).unwrap();
        assert!(s.created_by.is_none());
        let out = serde_json::to_value(&s).unwrap();
        assert!(out.get("createdBy").is_none(), "no new key on old records");
    }

    #[test]
    fn an_agent_creator_round_trips() {
        let mut rec = old_record();
        rec["createdBy"] = json!({
            "kind": "agent", "workspaceId": "parent-1", "parent": "session", "label": "Parent"
        });
        let s: ScratchSession = serde_json::from_value(rec).unwrap();
        assert_eq!(
            s.created_by,
            Some(CreatedBy::Agent {
                workspace_id: "parent-1".into(),
                parent: ParentKind::Session,
                label: "Parent".into(),
            })
        );
        let back: ScratchSession =
            serde_json::from_value(serde_json::to_value(&s).unwrap()).unwrap();
        assert_eq!(back.created_by, s.created_by);
    }

    #[test]
    fn schedule_and_orchestrator_creators_round_trip() {
        for cb in [
            CreatedBy::Orchestrator,
            CreatedBy::Peer {
                label: "studio-mac".into(),
            },
            CreatedBy::Schedule {
                prompt_id: "p1".into(),
                run_id: Some("r1".into()),
                label: "Nightly".into(),
            },
        ] {
            let v = serde_json::to_value(&cb).unwrap();
            assert_eq!(serde_json::from_value::<CreatedBy>(v).unwrap(), cb);
        }
    }

    #[test]
    fn an_unknown_or_broken_creator_reads_as_the_user_not_an_error() {
        for bad in [
            json!({ "kind": "robot", "name": "x" }),
            json!({ "kind": "agent" }),
            json!("user"),
        ] {
            let mut rec = old_record();
            rec["createdBy"] = bad;
            let s: ScratchSession = serde_json::from_value(rec).unwrap();
            assert!(s.created_by.is_none());
        }
    }

    #[test]
    fn sanitize_drops_the_user_and_nameless_parents_and_clips_labels() {
        assert_eq!(CreatedBy::User.sanitize(), None);
        let nameless = CreatedBy::Agent {
            workspace_id: "  ".into(),
            parent: ParentKind::Ticket,
            label: "x".into(),
        };
        assert_eq!(nameless.sanitize(), None);
        let long = CreatedBy::Agent {
            workspace_id: "ENG-1".into(),
            parent: ParentKind::Ticket,
            label: format!("  {}  ", "a".repeat(500)),
        };
        let Some(CreatedBy::Agent { label, .. }) = long.sanitize() else {
            panic!("kept");
        };
        assert_eq!(label.len(), 120);
        let unlabelled = CreatedBy::Agent {
            workspace_id: "ENG-2".into(),
            parent: ParentKind::Ticket,
            label: " ".into(),
        };
        let Some(CreatedBy::Agent { label, .. }) = unlabelled.sanitize() else {
            panic!("kept");
        };
        assert_eq!(label, "ENG-2");
        let Some(CreatedBy::Peer { label }) = (CreatedBy::Peer { label: " ".into() }).sanitize()
        else {
            panic!("kept");
        };
        assert_eq!(label, "another computer");
    }
}
