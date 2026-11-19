import { useEffect } from "react";
import { useLiveStore } from "@/domains/live/store";
import { finishedTurns } from "@/domains/live/unread";
import { shortReply } from "@/domains/orchestrator/oneLine";
import { isScheduledRun } from "@/domains/schedules/ids";
import { saveRecap } from "@/ipc/recaps";
import { readTranscript } from "@/ipc/transcript";
import { SETTLE_MS, waitBeforeRecap } from "./gate";
import { buildRecapPrompt, parseRecap, RECAP_SYSTEM, transcriptAsText } from "./prompt";
import { useRecapStore } from "./store";
import { hasRecap, type Recap } from "./types";

// Writes each agent's recap. When a turn finishes (any transport: the live store's
// light goes working → ready, or to a "needs input" nudge), the agent is queued; once
// it settles and the gate allows (`gate.ts`), the conversation since the last recap
// is read from Claude Code's own transcript file, Haiku updates the recap, and it's
// saved with the new offset. No transcript (codex, a sandbox, a peer) or no model
// transport (no key, no CLI) means no recap: the panel keeps showing the last message.

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const callTimes: number[] = [];
/** Agents with no conversation file this run of trace; not asked again until a turn ends. */
const noTranscript = new Set<string>();

function isRecapped(workspaceId: string): boolean {
  return !workspaceId.startsWith("term:") && !isScheduledRun(workspaceId);
}

/**
 * Queue a recap of `workspaceId`. `force` (the ↻ button) rebuilds it from the
 * conversation's newest end and skips the cooldown; `delay` overrides the settle wait.
 */
export function requestRecap(
  workspaceId: string,
  opts: { force?: boolean; delay?: number } = {}
): void {
  if (!isRecapped(workspaceId)) return;
  if (!opts.force && noTranscript.has(workspaceId)) return;
  const pending = timers.get(workspaceId);
  if (pending !== undefined) clearTimeout(pending);
  timers.set(
    workspaceId,
    setTimeout(() => void run(workspaceId, opts.force ?? false), opts.delay ?? SETTLE_MS)
  );
}

async function run(workspaceId: string, force: boolean): Promise<void> {
  timers.delete(workspaceId);
  const store = useRecapStore.getState();
  if (store.busy.has(workspaceId)) {
    requestRecap(workspaceId, { force });
    return;
  }
  const stored = store.recaps[workspaceId];
  const previous = hasRecap(stored) ? stored : null;
  const wait = waitBeforeRecap(previous?.at ?? 0, callTimes, Date.now(), force);
  if (wait === null) return;
  if (wait > 0) {
    requestRecap(workspaceId, { force, delay: wait });
    return;
  }
  store.setBusy(workspaceId, true);
  try {
    await write(workspaceId, previous, force);
  } catch {
    // Not this time: the next finished turn tries again.
  } finally {
    useRecapStore.getState().setBusy(workspaceId, false);
  }
}

async function write(workspaceId: string, previous: Recap | null, force: boolean): Promise<void> {
  // Carry on from the last recap's place in the same conversation; ↻ and a first
  // recap read the conversation's newest end instead.
  const from = !force && previous?.sessionId ? previous : null;
  const page = await readTranscript(workspaceId, from?.sessionId ?? null, from?.offset ?? 0);
  if (!page) {
    noTranscript.add(workspaceId);
    return;
  }
  noTranscript.delete(workspaceId);
  const conversation = transcriptAsText(page.items);
  if (!conversation) return;
  const note = useLiveStore.getState().info[workspaceId]?.update ?? null;
  callTimes.push(Date.now());
  if (callTimes.length > 200) callTimes.splice(0, callTimes.length - 200);
  const raw = await shortReply(RECAP_SYSTEM, buildRecapPrompt(previous, conversation, note));
  const text = raw === null ? null : parseRecap(raw, previous);
  if (!text) return;
  const saved = await saveRecap(workspaceId, {
    ...text,
    at: Date.now(),
    sessionId: page.sessionId,
    offset: page.offset,
    seenAt: previous?.seenAt ?? 0,
  });
  useRecapStore.getState().put(workspaceId, saved);
}

/**
 * Mount once (app shell): load the saved recaps, and queue a recap whenever an
 * agent finishes a turn.
 */
export function useRecapSync(): void {
  useEffect(() => {
    void useRecapStore.getState().load();
    return useLiveStore.subscribe((s, prev) => {
      if (s.info === prev.info) return;
      for (const id of finishedTurns(prev.info, s.info, () => true)) {
        noTranscript.delete(id);
        requestRecap(id);
      }
    });
  }, []);
}

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
