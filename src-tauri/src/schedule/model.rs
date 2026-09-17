//! Scheduled prompts and their runs — the persisted shapes (mirrored in the
//! frontend's `domains/schedules/types.ts`), plus the validation that turns form
//! input into a prompt worth saving.

use serde::{Deserialize, Serialize};

use super::timing::Schedule;
use crate::helpers::new_id;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPrompt {
    pub id: String,
    pub title: String,
    /// The prompt template; `{date}`-style variables are filled in per run.
    pub prompt: String,
    /// Configured repo the prompt's worktree lives in; `None` = the default repo.
    #[serde(default)]
    pub repo: Option<String>,
    /// Model provider for the Claude harness (`commands::providers` id); `None` =
    /// Anthropic.
    #[serde(default)]
    pub provider: Option<String>,
    /// `--model` value; `None` = the CLI's default.
    #[serde(default)]
    pub model: Option<String>,
    /// Extra CLI flags, saved with the prompt: the agent defaults live in the
    /// renderer's localStorage, which the scheduler thread can't read. Usually a
    /// permission mode — nobody is there to approve a prompt mid-run.
    #[serde(default)]
    pub extra_args: Vec<String>,
    pub schedule: Schedule,
    pub enabled: bool,
    /// Kill a run still going after this many minutes; 0 = no limit.
    pub timeout_mins: u32,
    /// Native notification when a run finishes, fails, or needs input.
    pub notify: bool,
    pub created_at: i64,
    /// Where intervals count from (epoch secs); reset whenever the schedule changes.
    pub anchor_at: i64,
    /// Next firing (epoch secs); `None` while paused.
    #[serde(default)]
    pub next_run_at: Option<i64>,
    /// When the latest run started — feeds the `{lastRunAt}` variable.
    #[serde(default)]
    pub last_run_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Running,
    Succeeded,
    Failed,
    TimedOut,
    Stopped,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Trigger {
    Schedule,
    Manual,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRun {
    pub id: String,
    pub prompt_id: String,
    pub trigger: Trigger,
    pub status: RunStatus,
    pub started_at: i64,
    #[serde(default)]
    pub ended_at: Option<i64>,
    /// The prompt exactly as sent, variables filled in. Empty until launched.
    #[serde(default)]
    pub prompt: String,
    /// The run's Claude conversation — what "Continue as session" resumes.
    #[serde(default)]
    pub claude_session_id: Option<String>,
    /// Claude asked for a human (usually a permission prompt) during the run.
    #[serde(default)]
    pub needs_input: bool,
    /// Firings skipped because this run was still going when they came due.
    #[serde(default)]
    pub skipped: u32,
    #[serde(default)]
    pub error: Option<String>,
    /// The terminal output was saved to disk (`transcript`) and can be replayed.
    #[serde(default)]
    pub has_transcript: bool,
}

/// What the create/edit form sends. `id` = `None` creates a new prompt.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptInput {
    pub id: Option<String>,
    pub title: String,
    pub prompt: String,
    pub repo: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    pub schedule: Schedule,
    pub timeout_mins: u32,
    pub notify: bool,
}

/// Longest allowed run timeout (a day).
const MAX_TIMEOUT_MINS: u32 = 24 * 60;

impl PromptInput {
    /// Validate and build the prompt to save: a new one, or `existing` updated
    /// in place (keeping its id, pause state and history). Changing the schedule
    /// re-anchors it, so an edited interval counts from now.
    pub fn build(
        self,
        existing: Option<&ScheduledPrompt>,
        now: i64,
    ) -> Result<ScheduledPrompt, String> {
        let title = self.title.trim().to_string();
        if title.is_empty() {
            return Err("Give the prompt a name.".to_string());
        }
        if self.prompt.trim().is_empty() {
            return Err("Write the prompt to run.".to_string());
        }
        self.schedule.validate()?;
        if self.timeout_mins > MAX_TIMEOUT_MINS {
            return Err("Timeouts can be at most 24 hours.".to_string());
        }
        let repo = trimmed(self.repo);
        match &repo {
            Some(r) if !crate::commands::repos::all_repos().contains(r) => {
                return Err("That repository isn't configured.".to_string());
            }
            None if crate::commands::repos::default_repo().is_none() => {
                return Err("Add a repository in Settings first.".to_string());
            }
            _ => {}
        }
        let schedule_changed = existing.is_none_or(|e| e.schedule != self.schedule);
        let anchor_at = match existing {
            Some(e) if !schedule_changed => e.anchor_at,
            _ => now,
        };
        let enabled = existing.is_none_or(|e| e.enabled);
        Ok(ScheduledPrompt {
            id: existing.map_or_else(new_id, |e| e.id.clone()),
            title,
            prompt: self.prompt,
            repo,
            provider: self
                .provider
                .filter(|p| crate::commands::providers::spec(p).is_some()),
            model: trimmed(self.model),
            extra_args: self
                .extra_args
                .into_iter()
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty())
                .collect(),
            next_run_at: if enabled {
                self.schedule.next_after(now, anchor_at)
            } else {
                None
            },
            schedule: self.schedule,
            enabled,
            timeout_mins: self.timeout_mins,
            notify: self.notify,
            created_at: existing.map_or(now, |e| e.created_at),
            anchor_at,
            last_run_at: existing.and_then(|e| e.last_run_at),
        })
    }
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}
