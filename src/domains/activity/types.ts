// The activity event shape — mirrors `src-tauri/src/activity/model.rs`.

export type ActivityKind =
  | "transition"
  | "agent-start"
  | "pr-raised"
  | "pr-merged"
  | "session-created"
  /** Claude is blocked on a human (usually a permission prompt). */
  | "agent-needs-input"
  /** An agent's turn ended; `data.backgroundTasks` / `data.lastMessage`. */
  | "agent-turn-end"
  | "agent-exit"
  | "schedule-run-started"
  | "schedule-run-succeeded"
  | "schedule-run-failed"
  | "checks-failed"
  | "checks-passed"
  /** A kind this build doesn't know (written by a newer one). */
  | "other";

/** Who caused an event. Automated readers must never react to their own ("orchestrator"). */
export type ActivityActor = "user" | "orchestrator" | "agent" | "schedule" | "system";

export interface ActivityEvent {
  id: string;
  /** Epoch ms. */
  at: number;
  kind: ActivityKind;
  actor: ActivityActor;
  /** Issue key for the chip, when the event is tied to one. */
  issueKey?: string;
  /** The agent/run workspace it came from, when there is one. */
  workspaceId?: string;
  /** Display name when the event isn't about an issue (a session's title). */
  subject?: string;
  /** Human description shown after the key chip, e.g. "→ In Review". */
  title: string;
  /** Kind-specific structured detail (e.g. Claude's closing message). */
  data?: Record<string, unknown>;
}

/** What a producer submits; the backend stamps the id and time. */
export interface ActivityInput {
  kind: ActivityKind;
  actor?: ActivityActor;
  issueKey?: string;
  workspaceId?: string;
  subject?: string;
  title: string;
  data?: Record<string, unknown>;
}
