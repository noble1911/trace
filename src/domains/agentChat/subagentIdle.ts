import type { SubagentThread } from "./subagents.ts";

// Which subagent tabs close by themselves: a finished subagent's, a while after it
// finished, if its tab was never shown. Pure (relative `.ts` imports) so `npm test`
// runs it; `subagentAutoClose.ts` applies it. Closing only hides the tab
// (`closedTabs.ts`): its card in the chat brings it back.

/** How long a finished subagent's unseen tab stays. */
export const IDLE_CLOSE_MS = 5 * 60_000;

export type IdleThread = Pick<
  SubagentThread,
  "callId" | "status" | "pending" | "startedAt" | "durationMs"
>;

/** Done, failed or stopped, and not waiting on you: a tab that may close. */
export const isFinished = (t: IdleThread) => t.status !== "running" && !t.pending;

/**
 * When it finished: by the duration the agent reported, else when trace first saw it
 * finished (a subagent whose end came without a duration). Null while it runs.
 */
export function finishedAt(t: IdleThread, firstSeenFinished: number | undefined): number | null {
  if (!isFinished(t)) return null;
  if (t.durationMs !== null) return t.startedAt + t.durationMs;
  return firstSeenFinished ?? null;
}

export interface IdleContext {
  now: number;
  /** Call ids whose tab has been shown in a pane, or arranged into a layout. */
  seen: ReadonlySet<string>;
  /** Call ids whose tab is already closed. */
  closed: readonly string[];
  /** When trace first saw each call finished, by call id. */
  firstSeenFinished: ReadonlyMap<string, number>;
}

/** The call ids of `threads` whose tabs should close now. */
export function idleTabs(threads: readonly IdleThread[], ctx: IdleContext): string[] {
  return threads
    .filter((t) => !ctx.seen.has(t.callId) && !ctx.closed.includes(t.callId))
    .filter((t) => {
      const at = finishedAt(t, ctx.firstSeenFinished.get(t.callId));
      return at !== null && ctx.now - at >= IDLE_CLOSE_MS;
    })
    .map((t) => t.callId);
}
