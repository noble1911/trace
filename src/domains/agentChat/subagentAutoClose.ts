import { allTabs, visibleTabs } from "@/domains/panes/model";
import { usePaneLayoutStore } from "@/domains/panes/store";
import { useTabSettings } from "@/domains/panes/tabSettings";
import { closeSubagentTabs, useClosedTabs } from "./closedTabs";
import { chatOf } from "./hooks/useChat";
import { useAgentChatStore } from "./store";
import { idleTabs, isFinished } from "./subagentIdle";
import { subagentPanelId } from "./subagentPanel";

// Closes finished subagents' tabs nobody looked at (`subagentIdle.ts` says which),
// while Settings → Tabs leaves it on. "Looked at" is a tab shown in a pane this run,
// or one the user arranged into a stored layout (Open beside, a split): either
// keeps it. A closed tab only hides; its card in the chat brings it back.

const TICK_MS = 30_000;

/** Subagent panel ids shown in a pane this run, or arranged into a layout. */
const seenPanels = new Set<string>();
/** When each subagent was first seen finished, by panel id (for ones with no duration). */
const firstSeenFinished = new Map<string, number>();

const isSubagentPanel = (id: string) => id.startsWith("sub:");

function noteSeen(): void {
  const { saved, picked } = usePaneLayoutStore.getState();
  const note = (ids: string[]) => {
    for (const id of ids) if (isSubagentPanel(id)) seenPanels.add(id);
  };
  for (const { layout } of Object.values(saved)) note(allTabs(layout));
  for (const layout of Object.values(picked)) note(visibleTabs(layout));
}

function tick(now: number): void {
  if (!useTabSettings.getState().autoCloseSubagents) return;
  const { journals, transport } = useAgentChatStore.getState();
  const { closed } = useClosedTabs.getState();
  for (const [workspaceId, journal] of Object.entries(journals)) {
    if (transport[workspaceId] !== "chat") continue;
    const threads = chatOf(journal.rows).subagents;
    const panel = (callId: string) => subagentPanelId(workspaceId, callId);
    for (const t of threads) {
      if (isFinished(t) && !firstSeenFinished.has(panel(t.callId))) {
        firstSeenFinished.set(panel(t.callId), now);
      }
    }
    const seen = new Set(threads.map((t) => t.callId).filter((c) => seenPanels.has(panel(c))));
    const firstSeen = new Map(
      threads.flatMap((t) => {
        const at = firstSeenFinished.get(panel(t.callId));
        return at === undefined ? [] : [[t.callId, at] as const];
      })
    );
    const idle = idleTabs(threads, {
      now,
      seen,
      closed: closed[workspaceId] ?? [],
      firstSeenFinished: firstSeen,
    });
    closeSubagentTabs(workspaceId, idle);
  }
}

/** Start closing idle subagent tabs; returns the stop. Call once, from the app shell. */
export function startSubagentAutoClose(): () => void {
  noteSeen();
  const offPanes = usePaneLayoutStore.subscribe(noteSeen);
  const timer = window.setInterval(() => tick(Date.now()), TICK_MS);
  return () => {
    offPanes();
    window.clearInterval(timer);
  };
}

// A hot update would leave a second timer and a stale seen set, so reload instead.
import.meta.hot?.accept(() => location.reload());
