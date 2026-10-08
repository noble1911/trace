import type { ActivityEvent, ActivityKind } from "@/domains/activity/types";
import type { Mood } from "./spriteContract";

// The buddy's body language, derived deterministically from the board and the
// activity log — instant and free (only speech costs an LLM call).

const SUCCESS = new Set<ActivityKind>(["pr-merged", "checks-passed", "schedule-run-succeeded"]);
const FAILURE = new Set<ActivityKind>(["checks-failed", "schedule-run-failed"]);
const NEEDS_YOU = new Set<ActivityKind>(["agent-needs-input"]);

const HAPPY_MS = 20_000;
const WORRIED_MS = 3 * 60_000;
/** Backstop for agents the board doesn't track (scheduled runs). */
const ALERT_MS = 30_000;
export const SLEEP_AFTER_MS = 15 * 60_000;

export interface MoodInput {
  /** Newest first. */
  events: ActivityEvent[];
  /** Running agents the user hasn't looked at since they started waiting. */
  waitingAgents: number;
  workingAgents: number;
  now: number;
  /** Last time the user poked/petted the buddy (or it mounted). */
  lastInteractionAt: number;
}

function latest(events: ActivityEvent[], kinds: Set<ActivityKind>, now: number, ms: number) {
  return events.find((e) => kinds.has(e.kind) && now - e.at <= ms)?.at ?? null;
}

export function deriveMood(input: MoodInput): Mood {
  const { events, now } = input;
  if (input.waitingAgents > 0 || latest(events, NEEDS_YOU, now, ALERT_MS) !== null) return "alert";

  // Good and bad news both linger; whichever landed last wins.
  const failedAt = latest(events, FAILURE, now, WORRIED_MS);
  const succeededAt = latest(events, SUCCESS, now, HAPPY_MS);
  if (failedAt !== null && (succeededAt === null || failedAt > succeededAt)) return "worried";
  if (succeededAt !== null) return "happy";

  if (input.workingAgents > 0) return "working";

  const lastEventAt = events[0]?.at ?? 0;
  const quietFor = now - Math.max(lastEventAt, input.lastInteractionAt);
  return quietFor >= SLEEP_AFTER_MS ? "sleeping" : "idle";
}

/**
 * Working / waiting agent counts from the board's run state. Shell terminals
 * (`term:`) run in the same set but aren't agents. Waiting the user has already
 * seen (acked) doesn't count — the buddy shouldn't nag about it.
 */
export function countAgents(
  running: Set<string>,
  activity: Record<string, "working" | "waiting">,
  acked: Set<string>
): { working: number; waiting: number } {
  let working = 0;
  let waiting = 0;
  for (const key of running) {
    if (key.startsWith("term:")) continue;
    const state = activity[key] ?? "working";
    if (state === "working") working++;
    else if (!acked.has(key)) waiting++;
  }
  return { working, waiting };
}
