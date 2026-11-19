//! What Claude says about the session rather than the conversation: `system`
//! lines (init, compaction, retries) and `rate_limit_event`, mostly as
//! `SessionInfo`.

use serde_json::Value;

use super::{Out, Translator};
use crate::agent_session::claude::prompts::str_at;
use crate::agent_session::journal::Tone;
use crate::agent_session::{LimitWindow, SessionInfo};

impl Translator {
    pub(super) fn system(&mut self, m: &Value, out: &mut Vec<Out>) {
        match str_at(m, "subtype") {
            Some("init") => {
                let commands: Vec<String> = m["slash_commands"]
                    .as_array()
                    .map(|c| {
                        c.iter()
                            .filter_map(|s| s.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                let model = str_at(m, "model").map(str::to_string);
                let session = str_at(m, "session_id").map(str::to_string);
                let mode = str_at(m, "permissionMode").map(str::to_string);
                // Only some hosts name it (not headless 2.1.319).
                let effort = str_at(m, "effort").map(str::to_string);
                self.set_info(out, |info| {
                    info.model = model.or(info.model.take());
                    info.conversation_id = session.or(info.conversation_id.take());
                    info.slash_commands = commands;
                    info.permission_mode = mode.or(info.permission_mode.take());
                    info.effort = effort.or(info.effort.take());
                });
            }
            // A mode change (ours, or Claude leaving plan mode by itself).
            Some("status") => {
                if let Some(mode) = str_at(m, "permissionMode") {
                    let mode = mode.to_string();
                    self.set_info(out, |i| i.permission_mode = Some(mode));
                }
            }
            Some(
                sub @ ("task_started" | "task_progress" | "task_updated" | "task_notification"),
            ) => {
                self.task_event(m, sub, out);
            }
            Some("compact_boundary") => {
                self.status("Conversation compacted.", Tone::Info, out);
            }
            Some("api_retry") => {
                let attempt = m["attempt"].as_u64().unwrap_or(0);
                let text = format!("The API request failed; retrying (attempt {attempt}).");
                self.status(&text, Tone::Warning, out);
            }
            _ => {}
        }
    }

    pub(super) fn rate_limits(&mut self, info: &Value, out: &mut Vec<Out>) {
        let mut limits: Vec<LimitWindow> = info["unifiedWindows"]
            .as_object()
            .map(|windows| {
                windows
                    .iter()
                    .filter_map(|(name, w)| {
                        Some(LimitWindow {
                            name: name.clone(),
                            utilization: w["utilization"].as_f64()?,
                            resets_at: w["resetsAt"].as_u64(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        if limits.is_empty() {
            if let (Some(name), Some(u)) =
                (str_at(info, "rateLimitType"), info["utilization"].as_f64())
            {
                limits.push(LimitWindow {
                    name: name.to_string(),
                    utilization: u,
                    resets_at: info["resetsAt"].as_u64(),
                });
            }
        }
        if !limits.is_empty() {
            self.set_info(out, |i| i.limits = limits);
        }
    }

    /// Apply a change to the session info, sending it on only if it changed.
    pub(super) fn set_info(&mut self, out: &mut Vec<Out>, f: impl FnOnce(&mut SessionInfo)) {
        let before = self.info.clone();
        f(&mut self.info);
        if self.info != before {
            out.push(Out::Info(self.info.clone()));
        }
    }
}
