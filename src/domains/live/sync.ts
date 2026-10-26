import { useEffect } from "react";
import { useBoardStore } from "@/domains/board/store";
import { isScheduledRun } from "@/domains/schedules/ids";
import type { AgentAsk, AgentTurn } from "@/ipc/events";
import { askFrom, askFromTool } from "./ask";
import { lightOf } from "./light";
import { loadOpenedAt, saveOpenedAt } from "./prefs";
import { useLiveStore } from "./store";
import type { LiveInfo } from "./types";

// Keeps `useLiveStore` in step with the board store's raw agent signals and the
// hooks' turn events. The board store import is circular by design (it reaches
// `clearAsk` through waitingNotify) — both sides only touch the other inside
// functions, never at module scope.

type BoardSignals = Pick<
  ReturnType<typeof useBoardStore.getState>,
  "runningAgents" | "agentActivity" | "ackedWaiting"
>;

const openedAt = loadOpenedAt();
const FORGET_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * An idle TUI repaints (opening a session sends a resize, which redraws it), and
 * any output reads as "working" until the quiet timer flips it back. A light that
 * returns this soon to what it was is a flicker, not a change — it keeps its age.
 */
const FLICKER_MS = 5000;
const settled = new Map<string, { light: LiveInfo["light"]; since: number; left: number }>();

/** When the light now showing really began, looking through a repaint flicker. */
function sinceFor(id: string, prev: LiveInfo | undefined, light: LiveInfo["light"], now: number) {
  const back = settled.get(id);
  if (prev) settled.set(id, { light: prev.light, since: prev.since, left: now });
  if (back && back.light === light && now - back.left < FLICKER_MS) return back.since;
  return now;
}

/** Shells have no agent in them, so no light. */
const isAgent = (id: string) => !id.startsWith("term:");

function recompute(board: BoardSignals) {
  const live = useLiveStore.getState();
  const now = Date.now();
  const next: Record<string, LiveInfo> = {};
  let changed = false;
  for (const id of board.runningAgents) {
    if (!isAgent(id)) continue;
    const prev = live.info[id];
    const ask = prev?.ask ?? null;
    const light = lightOf({
      running: true,
      activity: board.agentActivity[id],
      acked: board.ackedWaiting.has(id),
      ask,
      scheduled: isScheduledRun(id),
    });
    if (prev && prev.light === light) {
      next[id] = prev;
      continue;
    }
    changed = true;
    openedAt[id] ??= now;
    next[id] = {
      light,
      openedAt: openedAt[id],
      since: sinceFor(id, prev, light, now),
      ask,
      lastMessage: prev?.lastMessage ?? null,
    };
  }
  const gone = Object.keys(live.info).filter((id) => !(id in next));
  if (gone.length > 0) changed = true;
  if (!changed) return;
  live.replace(next);
  // Forget agents seen to stop, so restarting one counts as new — in opened
  // order and in a dragged one. Agents not re-adopted yet after a reload keep
  // their time; one gone for a week is long gone (a running one never expires).
  for (const id of gone) {
    delete openedAt[id];
    settled.delete(id);
  }
  for (const [id, t] of Object.entries(openedAt)) {
    if (!(id in next) && now - t > FORGET_AFTER_MS) delete openedAt[id];
  }
  saveOpenedAt(openedAt);
  if (gone.length > 0) live.forget(gone);
}

function patchAndRecompute(workspaceId: string, patch: Partial<LiveInfo>) {
  // Recompute first so an event racing the agent's first update has an entry to land on.
  recompute(useBoardStore.getState());
  useLiveStore.getState().patch(workspaceId, patch);
  recompute(useBoardStore.getState());
}

/** A hook-reported turn: remember what the agent asks for, or what it said. */
export function noteLiveTurn(turn: AgentTurn): void {
  if (!isAgent(turn.workspaceId)) return;
  if (turn.event === "needsInput") {
    // The PermissionRequest hook fires first and says far more; the generic
    // Notification that follows mustn't overwrite it.
    if (useLiveStore.getState().info[turn.workspaceId]?.ask) return;
    patchAndRecompute(turn.workspaceId, { ask: askFrom(turn.notificationType, turn.message) });
    return;
  }
  // A turn that ends has had its question answered one way or another.
  const prev = useLiveStore.getState().info[turn.workspaceId];
  patchAndRecompute(turn.workspaceId, {
    ask: null,
    lastMessage: turn.lastMessage ?? prev?.lastMessage ?? null,
  });
}

/** A permission dialog is about to show: what it's for (`claude::permission_ask`). */
export function noteLiveAsk(event: AgentAsk): void {
  if (!isAgent(event.workspaceId)) return;
  patchAndRecompute(event.workspaceId, { ask: askFromTool(event) });
}

/** The user gave the agent input — whatever it asked has been answered. */
export function clearAsk(workspaceId: string): void {
  if (!useLiveStore.getState().info[workspaceId]?.ask) return;
  patchAndRecompute(workspaceId, { ask: null });
}

/** Mount once (App): derive lights now and whenever the board's signals change. */
export function useLiveSync(): void {
  useEffect(() => {
    recompute(useBoardStore.getState());
    return useBoardStore.subscribe((s, prev) => {
      if (
        s.runningAgents === prev.runningAgents &&
        s.agentActivity === prev.agentActivity &&
        s.ackedWaiting === prev.ackedWaiting
      ) {
        return;
      }
      recompute(s);
    });
  }, []);
}
