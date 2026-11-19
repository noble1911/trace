// When a recap may be written. Every recap is a Haiku call, so this is the cost
// control (the buddy's `speech.ts` does the same for its bubbles): one at a time
// per agent, a cooldown between an agent's recaps, and an hourly cap across all.
// A turn that ends inside the cooldown isn't dropped: it waits for the cooldown,
// so the recap always ends up describing the agent's latest turn.

/** Quiet time after a turn ends, so a burst of short turns makes one recap. */
export const SETTLE_MS = 4_000;
/** Least time between two recaps of the same agent. */
export const COOLDOWN_MS = 90_000;
/** Most recaps written in any hour, across every agent. */
export const HOURLY_CAP = 60;

/** Calls made in the hour before `now`. */
export function callsInLastHour(callTimes: readonly number[], now: number): number {
  return callTimes.filter((t) => now - t < 3_600_000).length;
}

/**
 * Milliseconds to wait before recapping an agent (0 = now), or null when the
 * hourly cap is spent. `lastAt` is when its last recap was written (0 = never);
 * `force` (the ↻ button) skips the cooldown but not the cap.
 */
export function waitBeforeRecap(
  lastAt: number,
  callTimes: readonly number[],
  now: number,
  force = false
): number | null {
  if (callsInLastHour(callTimes, now) >= HOURLY_CAP) return null;
  if (force || lastAt === 0) return 0;
  return Math.max(0, lastAt + COOLDOWN_MS - now);
}
