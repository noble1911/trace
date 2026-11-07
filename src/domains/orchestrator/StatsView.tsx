import { useMemo } from "react";
import { useActivityStore } from "@/domains/activity/store";
import { useAgentChatStore } from "@/domains/agentChat/store";
import { useBoardStore } from "@/domains/board/store";
import { lightsOf, useLiveStore } from "@/domains/live/store";
import { useSessionsStore } from "@/domains/sessions/store";
import { useNow } from "@/hooks/useNow";
import type { SessionOverview } from "@/ipc/workspace";
import { BoardStats } from "./BoardStats";
import { SessionStatsPanel } from "./SessionStatsPanel";
import { useSessionJournals } from "./sessionContext";
import { computeSessionStats } from "./sessionStats";

// The deterministic overview — no AI. The board's numbers when a board is
// loaded, and the standalone sessions and their agents always: alongside the
// board, or on their own when no tracker is connected.
export function StatsView({ overview }: { overview: Record<string, SessionOverview> }) {
  const board = useBoardStore((s) => s.data);
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const live = useLiveStore((s) => s.info);
  const activity = useActivityStore((s) => s.events);
  const sessions = useSessionsStore((s) => s.sessions);
  const journals = useAgentChatStore((s) => s.journals);
  const now = Math.floor(useNow(30_000) * 1000);
  useSessionJournals();

  const sessionStats = useMemo(
    () =>
      computeSessionStats({
        sessions,
        runningAgents,
        lights: lightsOf(live),
        overview,
        journals,
        activity,
        now,
      }),
    [sessions, runningAgents, live, overview, journals, activity, now]
  );

  return (
    <div className="orch-stats">
      {board && <BoardStats board={board} />}
      <SessionStatsPanel stats={sessionStats} now={now} withBoard={board !== null} />
    </div>
  );
}
