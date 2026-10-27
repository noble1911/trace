import { invoke } from "@tauri-apps/api/core";

// Agents the previous run of trace was cut off from (quit, update, crash) —
// `interrupted` in Rust.

/** What an interrupted agent was started with. */
export interface InterruptedAgent {
  workspaceId: string;
  cwd: string;
  cli: string;
  model?: string | null;
  provider?: string | null;
  /** Epoch secs it was started. */
  startedAt: number;
  /** Mid-turn when trace went down — a Claude agent is told to carry on. */
  busy: boolean;
}

export interface ResumeResult {
  workspaceId: string;
  /** Why it couldn't be resumed; null when it was. */
  error?: string | null;
}

export function interruptedAgents(): Promise<InterruptedAgent[]> {
  return invoke("interrupted_agents");
}

/** Start them again, each carrying on its saved conversation (told to continue if busy). */
export function resumeInterruptedAgents(ids: string[]): Promise<ResumeResult[]> {
  return invoke("resume_interrupted_agents", { ids });
}

/** Forget them without resuming. */
export function dismissInterruptedAgents(): Promise<void> {
  return invoke("dismiss_interrupted_agents");
}
