import { invoke } from "@tauri-apps/api/core";
import type {
  PromptInput,
  Schedule,
  ScheduledPrompt,
  ScheduleRun,
} from "@/domains/schedules/types";
import type { ScratchSession } from "@/domains/sessions/types";

// Typed wrappers around the scheduled-prompt commands. A run's live terminal,
// input and resize reuse the agent commands (ipc/agent.ts) keyed `sched:<runId>`.

/** Every scheduled prompt, newest first. */
export function listScheduledPrompts(): Promise<ScheduledPrompt[]> {
  return invoke("list_scheduled_prompts");
}

/** Every run across all prompts, newest first. */
export function listScheduleRuns(): Promise<ScheduleRun[]> {
  return invoke("list_schedule_runs");
}

/** Create (no id) or update a prompt. Rejects with a message fit for the form. */
export function saveScheduledPrompt(input: PromptInput): Promise<ScheduledPrompt> {
  return invoke("save_scheduled_prompt", { input });
}

export function setScheduledPromptEnabled(id: string, enabled: boolean): Promise<ScheduledPrompt> {
  return invoke("set_scheduled_prompt_enabled", { id, enabled });
}

/** Delete a prompt, its run history and transcripts, and its worktree. */
export function deleteScheduledPrompt(id: string): Promise<void> {
  return invoke("delete_scheduled_prompt", { id });
}

/** Fire a prompt now; resolves once the run is recorded (it starts in the background). */
export function runScheduledPromptNow(id: string): Promise<ScheduleRun> {
  return invoke("run_scheduled_prompt_now", { id });
}

export function stopScheduledRun(runId: string): Promise<void> {
  return invoke("stop_scheduled_run", { runId });
}

/**
 * Validate a schedule and get its next firings (epoch secs). Rejects with the
 * validation message. Pass the prompt's anchor when previewing an unchanged
 * interval so the preview matches what's saved.
 */
export function previewSchedule(schedule: Schedule, anchorAt?: number): Promise<number[]> {
  return invoke("preview_schedule", { schedule, anchorAt: anchorAt ?? null });
}

/** Turn a finished run into an exploratory session resuming its conversation. */
export function continueRunAsSession(runId: string): Promise<ScratchSession> {
  return invoke("continue_run_as_session", { runId });
}
