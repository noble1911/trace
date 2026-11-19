import type { SubagentThread } from "./subagents.ts";
import type { BackgroundTask, TaskKind } from "./types.ts";

// What's running behind a chat agent's conversation, as one list for its fact
// strip (`BackgroundWork`): its running subagents (each also has a card and a
// tab) and the tasks that have nothing else on screen once their call returns —
// a shell left running, a monitor, a workflow (`SessionInfo.background`).

export type BackgroundKind = "subagent" | TaskKind;

export interface BackgroundItem {
  key: string;
  kind: BackgroundKind;
  label: string;
  /** Unix ms. */
  startedAt: number;
  /** The call that started it: what Stop names. None: it can't be stopped alone. */
  callId: string | null;
  /** A subagent waiting on your answer. */
  pending: boolean;
}

const WORD: Record<BackgroundKind, string> = {
  subagent: "Subagent",
  shell: "Shell",
  monitor: "Monitor",
  workflow: "Workflow",
  agent: "Agent",
  other: "Task",
};

/** What the strip calls a kind. */
export const kindWord = (kind: BackgroundKind) => WORD[kind];

/** Running subagents and background tasks, oldest first. */
export function backgroundItems(
  subagents: readonly SubagentThread[],
  tasks: readonly BackgroundTask[]
): BackgroundItem[] {
  const items: BackgroundItem[] = subagents
    .filter((s) => s.status === "running")
    .map((s) => ({
      key: `sub:${s.callId}`,
      kind: "subagent",
      label: s.label,
      startedAt: s.startedAt,
      callId: s.callId,
      pending: s.pending,
    }));
  for (const t of tasks) {
    items.push({
      key: `task:${t.taskId}`,
      kind: t.kind,
      label: t.description.trim() || WORD[t.kind],
      startedAt: t.startedAt,
      callId: t.callId ?? null,
      pending: false,
    });
  }
  return items.sort((a, b) => a.startedAt - b.startedAt);
}
