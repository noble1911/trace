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
  /** Auto-cleanup deleted an idle workspace's checkout; `data.branchKept`. */
  | "workspace-removed"
  /** An agent's turn was interrupted from outside it (`interrupt_session`). */
  | "agent-interrupted"
  /** An agent was stopped from outside it (`stop_session`). */
  | "agent-stopped"
  /** A session went to the recycle bin from outside it (`remove_session`). */
  | "session-archived"
  /** A repository joined trace's list (an agent's approved `add_repo` / `clone_repo`). */
  | "repo-added"
  /** An agent opened a page in the Browser tab (`open_browser`); `data.url`, `data.external`. */
  | "page-opened"
  /** An agent showed images in the Gallery tab (`show_images`); `data.count`, `data.roots`. */
  | "images-shown"
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
