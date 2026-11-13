import type { LiveInfo } from "./types.ts";

// "New since you looked" (Slack's bold unread): a session whose agent finished a
// turn the user hasn't opened the session since. Weight, not colour: the amber
// light and the count stay for Needs you (a hook-reported ask). The pure half —
// which agents just finished a turn, and how the unread list changes — lives
// here, so it can be tested; `unreadSync.ts` wires it to the stores.

/**
 * Agents that just finished a turn: `working` a moment ago, now `ready` with the
 * turn unseen (`isUnseen`: not acked, not a scheduled run), or waiting on the
 * "needs input" nudge. A permission or question isn't a finished turn. A repaint
 * of an idle agent the user has already seen goes `working` → `ready` too, but
 * seen, so it isn't news (the board store's ack only clears when the user gives
 * the agent new work). Nor is a repaint flicker: `sync.ts` hands its light back
 * its old `since`.
 */
export function finishedTurns(
  prev: Record<string, LiveInfo>,
  next: Record<string, LiveInfo>,
  isUnseen: (id: string) => boolean
): string[] {
  const out: string[] = [];
  for (const [id, info] of Object.entries(next)) {
    const was = prev[id];
    if (was?.light !== "working" || info.since < was.since) continue;
    if (
      info.light === "ready"
        ? isUnseen(id)
        : info.light === "attention" && info.ask?.kind === "input"
    ) {
      out.push(id);
    }
  }
  return out;
}

/** `unread` plus `ids`, unchanged (same array) when there's nothing new. */
export function withUnread(unread: readonly string[], ids: readonly string[]): readonly string[] {
  const added = ids.filter((id, i) => !unread.includes(id) && ids.indexOf(id) === i);
  return added.length === 0 ? unread : [...unread, ...added];
}

/** `unread` without `id`, unchanged (same array) when it wasn't there. */
export function withoutUnread(unread: readonly string[], id: string): readonly string[] {
  return unread.includes(id) ? unread.filter((x) => x !== id) : unread;
}

/**
 * Only sessions that still exist; `known` empty means the list hasn't loaded
 * yet, so nothing is dropped. Unchanged (same array) when nothing goes.
 */
export function pruneUnread(
  unread: readonly string[],
  known: readonly string[]
): readonly string[] {
  if (known.length === 0) return unread;
  const kept = unread.filter((id) => known.includes(id));
  return kept.length === unread.length ? unread : kept;
}
