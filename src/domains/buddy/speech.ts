import type { ActivityEvent, ActivityKind } from "@/domains/activity/types";

// When the buddy may speak. Every bubble is an LLM call, so this is the cost
// control: events are batched, gaps scale with how much the news matters, and
// an hourly cap bounds the worst case. Ambient events never cut the line —
// they ride along with whatever speaks next (or break a long silence).

export type Urgency = "urgent" | "notable" | "ambient";

const URGENT = new Set<ActivityKind>(["agent-needs-input", "checks-failed", "schedule-run-failed"]);
const NOTABLE = new Set<ActivityKind>([
  "pr-merged",
  "pr-raised",
  "checks-passed",
  "schedule-run-succeeded",
  "agent-start",
  "agent-exit",
  "session-created",
  "transition",
]);

/** Minimum quiet time since the last bubble before news of each level may speak. */
const GAP_MS: Record<Urgency, number> = {
  urgent: 10_000,
  notable: 60_000,
  ambient: 10 * 60_000,
};
const RANK: Record<Urgency, number> = { urgent: 2, notable: 1, ambient: 0 };

/** Wait this long after the first new event for related ones to arrive. */
export const BATCH_MS = 3_000;
export const HOURLY_CAP = 40;
/** Pokes are the user asking — a short gap, same hourly cap. */
export const POKE_GAP_MS = 4_000;
/** Events kept for one bubble; older ones in a burst are dropped. */
export const MAX_PENDING = 20;

export function urgencyOf(e: ActivityEvent): Urgency {
  if (URGENT.has(e.kind)) return "urgent";
  if (NOTABLE.has(e.kind)) return "notable";
  return "ambient";
}

export function topUrgency(events: ActivityEvent[]): Urgency {
  return events.reduce<Urgency>(
    (top, e) => (RANK[urgencyOf(e)] > RANK[top] ? urgencyOf(e) : top),
    "ambient"
  );
}

export function underHourlyCap(callTimes: number[], now: number): boolean {
  return callTimes.filter((t) => now - t < 3_600_000).length < HOURLY_CAP;
}

/** Milliseconds until `pending` may speak (0 = now), or null if it never will on its own. */
export function waitBeforeSpeaking(
  pending: ActivityEvent[],
  lastSpokeAt: number,
  callTimes: number[],
  now: number
): number | null {
  if (pending.length === 0 || !underHourlyCap(callTimes, now)) return null;
  return Math.max(0, lastSpokeAt + GAP_MS[topUrgency(pending)] - now);
}

/** The issue a bubble about these events should link to: the most urgent, newest. */
export function linkFor(events: ActivityEvent[]): string | undefined {
  const keyed = events.filter((e) => e.issueKey);
  const best = keyed.reduce<ActivityEvent | undefined>((b, e) => {
    if (!b) return e;
    const diff = RANK[urgencyOf(e)] - RANK[urgencyOf(b)];
    return diff > 0 || (diff === 0 && e.at > b.at) ? e : b;
  }, undefined);
  return best?.issueKey;
}

/** Cap a pending batch at MAX_PENDING, dropping the oldest ambient events first. */
export function trimPending(events: ActivityEvent[]): ActivityEvent[] {
  const out = [...events];
  while (out.length > MAX_PENDING) {
    const i = out.findIndex((e) => urgencyOf(e) === "ambient");
    out.splice(i === -1 ? 0 : i, 1);
  }
  return out;
}
