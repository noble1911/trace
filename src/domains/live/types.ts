/**
 * What a status light says about an agent — the one vocabulary every surface
 * uses (board cards, session rows, agent tabs, the inbox, the fleet, the rail):
 *
 * - `attention` — needs you: blocked on a question or permission, or finished a
 *   turn you haven't looked at yet.
 * - `working` — mid-turn, or busy with background agents.
 * - `ready` — alive at its prompt and already seen.
 * - `stopped` — no agent process.
 */
export type AgentLight = "working" | "attention" | "ready" | "stopped";

/** What kind of answer the agent is waiting for. */
export type AskKind = "permission" | "plan" | "question" | "input" | "turn";

/** What a waiting agent is asking for — "Permission · Bash", "Plan approval", … */
export interface Ask {
  kind: AskKind;
  /** Short label for pills and rows. */
  label: string;
  /** The tool a permission prompt is for (`Bash`, `Edit`, …), when known. */
  tool: string | null;
}

/** Everything trace tracks about one live agent beyond its PTY. */
export interface LiveInfo {
  light: AgentLight;
  /** When the agent was started (persisted, so order survives a restart). */
  openedAt: number;
  /** When `light` last changed — "waiting 6m". */
  since: number;
  /** A pending hook-reported ask; cleared when the user gives the agent input. */
  ask: Ask | null;
  /** Claude's closing words for its last turn, if its hooks reported one. */
  lastMessage: string | null;
}
