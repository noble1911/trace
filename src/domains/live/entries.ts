import { useBoardStore } from "@/domains/board/store";
import { runIdOf } from "@/domains/schedules/ids";
import { useSchedulesStore } from "@/domains/schedules/store";
import { agentRoster } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import { orderIds } from "./order";
import { useLiveStore } from "./store";
import type { LiveInfo } from "./types";

/** Where a live agent came from — what opening it should show. */
export type LiveSource = "ticket" | "session" | "scheduled";

/** One live agent, resolved to something a person recognises. */
export interface LiveEntry {
  /** The agent's workspace id (its PTY key). */
  id: string;
  source: LiveSource;
  title: string;
  /** Ticket key, "session · codex", or the schedule's name. */
  subtitle: string;
  /** The worktree it runs in (a companion shares its session's) — for diffs, branch, PR. */
  worktreeId: string | null;
  info: LiveInfo;
}

type Lookups = {
  issues: { key: string; summary: string }[];
  sessions: ReturnType<typeof useSessionsStore.getState>["sessions"];
  prompts: ReturnType<typeof useSchedulesStore.getState>["prompts"];
  runs: ReturnType<typeof useSchedulesStore.getState>["runs"];
};

function resolve(id: string, info: LiveInfo, l: Lookups): LiveEntry {
  const runId = runIdOf(id);
  if (runId) {
    const run = l.runs.find((r) => r.id === runId);
    const prompt = run ? l.prompts.find((p) => p.id === run.promptId) : undefined;
    const title = prompt?.title ?? "Scheduled run";
    return { id, source: "scheduled", title, subtitle: "scheduled", worktreeId: null, info };
  }
  for (const session of l.sessions) {
    const entry = agentRoster(session).find((r) => r.workspaceId === id);
    if (entry) {
      const subtitle = `session · ${entry.label}`;
      return {
        id,
        source: "session",
        title: session.title,
        subtitle,
        worktreeId: session.id,
        info,
      };
    }
  }
  const issue = l.issues.find((i) => i.key === id);
  return { id, source: "ticket", title: issue?.summary ?? id, subtitle: id, worktreeId: id, info };
}

/**
 * Every live agent — tickets, sessions and their companions, scheduled runs —
 * in list order: opened order unless the user dragged them. State never moves
 * a row; filtering is the caller's.
 */
export function useLiveEntries(): LiveEntry[] {
  const info = useLiveStore((s) => s.info);
  const manualOrder = useLiveStore((s) => s.manualOrder);
  const issues = useBoardStore((s) => s.data?.issues);
  const sessions = useSessionsStore((s) => s.sessions);
  const prompts = useSchedulesStore((s) => s.prompts);
  const runs = useSchedulesStore((s) => s.runs);
  const lookups: Lookups = { issues: issues ?? [], sessions, prompts, runs };
  const ids = orderIds(Object.keys(info), (id) => info[id].openedAt, manualOrder);
  return ids.map((id) => resolve(id, info[id], lookups));
}
