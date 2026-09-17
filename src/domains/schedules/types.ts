import type { AgentProvider } from "@/ipc/agent";

// Mirrors `schedule::model` / `schedule::timing` in Rust. Timestamps are epoch
// seconds.

export type IntervalUnit = "minutes" | "hours" | "days";

export type Schedule =
  | { kind: "interval"; every: number; unit: IntervalUnit }
  | { kind: "daily"; time: string }
  /** `weekdays`: 0 = Sunday … 6 = Saturday. */
  | { kind: "weekly"; weekdays: number[]; time: string }
  /** Clamped to the month's last day ("the 31st" fires on Feb 28). */
  | { kind: "monthly"; day: number; time: string }
  | { kind: "cron"; expr: string };

export type ScheduleKind = Schedule["kind"];

/** A prompt that runs itself on a schedule, in its own worktree. */
export interface ScheduledPrompt {
  id: string;
  title: string;
  /** Template — `{date}`-style variables are filled in per run. */
  prompt: string;
  /** Configured repo path; null/undefined = the default repo. */
  repo?: string | null;
  /** Null/undefined = Anthropic. */
  provider?: AgentProvider | null;
  model?: string | null;
  extraArgs: string[];
  schedule: Schedule;
  enabled: boolean;
  /** Kill a run still going after this long; 0 = no limit. */
  timeoutMins: number;
  notify: boolean;
  createdAt: number;
  /** Where intervals count from. */
  anchorAt: number;
  /** Null while paused. */
  nextRunAt?: number | null;
  lastRunAt?: number | null;
}

export type RunStatus = "running" | "succeeded" | "failed" | "timedOut" | "stopped";

export interface ScheduleRun {
  id: string;
  promptId: string;
  trigger: "schedule" | "manual";
  status: RunStatus;
  startedAt: number;
  endedAt?: number | null;
  /** The prompt exactly as sent (variables filled in); empty until launched. */
  prompt: string;
  /** The run's Claude conversation — what "Continue as session" resumes. */
  claudeSessionId?: string | null;
  /** Claude asked for a human during the run (usually a permission prompt). */
  needsInput: boolean;
  /** Firings skipped because this run was still going. */
  skipped: number;
  /**
   * Background tasks (agents, shells, workflows) Claude still had going when its
   * last turn ended — the run waits for them.
   */
  backgroundTasks: number;
  error?: string | null;
  /** Output was saved to disk and can be replayed. */
  hasTranscript: boolean;
}

/** What the create/edit form saves. No `id` = create. */
export interface PromptInput {
  id?: string | null;
  title: string;
  prompt: string;
  repo: string | null;
  provider: AgentProvider;
  model: string | null;
  extraArgs: string[];
  schedule: Schedule;
  timeoutMins: number;
  notify: boolean;
}
