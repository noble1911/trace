import { useEffect } from "react";
import { useActivityStore } from "@/domains/activity/store";
import { useAgentChatStore } from "@/domains/agentChat/store";
import { useBoardStore } from "@/domains/board/store";
import { liveLights } from "@/domains/live/store";
import { agentWorkspaceIds } from "@/domains/sessions/agentRoster";
import { cachedSessionsOverview } from "@/domains/sessions/hooks/useSessionsOverview";
import { useSessionsStore } from "@/domains/sessions/store";
import { loadJournal } from "@/ipc/agentChat";
import type { SessionStatsInput } from "./sessionStats";

// Gathers the sessions half of the orchestrator's stats from the stores: the
// sessions list, live lights, the Sessions page's branch/PR cache and the chat
// journals. The arithmetic lives in sessionStats.ts.

/** Workspaces whose saved journal this module asked for (once per run). */
const asked = new Set<string>();

/** Every agent workspace id on an active session. */
function activeAgentIds(): string[] {
  return useSessionsStore
    .getState()
    .sessions.filter((s) => !s.archivedAt)
    .flatMap(agentWorkspaceIds);
}

/**
 * Read the saved journals of session agents that no view has opened yet, so
 * chat-agent usage counts every one of them — the same load `chatTail` does.
 * A terminal agent has no journal and reads as empty.
 */
export async function ensureSessionJournals(): Promise<void> {
  const store = useAgentChatStore.getState();
  const missing = activeAgentIds().filter((id) => !store.loaded[id] && !asked.has(id));
  await Promise.all(
    missing.map(async (id) => {
      asked.add(id);
      const rows = await loadJournal(id).catch(() => null);
      if (!rows) {
        asked.delete(id);
        return;
      }
      const s = useAgentChatStore.getState();
      s.applyRows(id, rows);
      s.markLoaded(id);
    })
  );
}

/** Load the session journals while a stats surface is on screen. */
export function useSessionJournals(): void {
  const sessions = useSessionsStore((s) => s.sessions);
  useEffect(() => {
    if (sessions.length > 0) void ensureSessionJournals();
  }, [sessions]);
}

/** The sessions stats input as the stores hold it now. */
export function sessionStatsInput(): SessionStatsInput {
  return {
    sessions: useSessionsStore.getState().sessions,
    runningAgents: useBoardStore.getState().runningAgents,
    lights: liveLights(),
    overview: cachedSessionsOverview(),
    journals: useAgentChatStore.getState().journals,
    activity: useActivityStore.getState().events,
    now: Date.now(),
  };
}
