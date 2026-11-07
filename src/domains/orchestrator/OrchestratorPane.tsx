import { useMemo } from "react";
import { useSessionsOverview } from "@/domains/sessions/hooks/useSessionsOverview";
import { useSessionsStore } from "@/domains/sessions/store";
import { ChatView } from "./ChatView";
import { StatsView } from "./StatsView";
import { type OrchTab, useOrchestratorStore } from "./store";

const TABS: { id: OrchTab; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "stats", label: "Stats" },
];

// The orchestrator, as a view of the right-edge side panel: the assistant
// (Chat, where it opens) and the overview (Stats). Its tab and the conversation
// live in stores, so moving between the board, sessions and a ticket keeps your
// place.
export function OrchestratorPane() {
  const tab = useOrchestratorStore((s) => s.tab);
  const setTab = useOrchestratorStore((s) => s.setTab);
  // Keep the sessions' branch + PR facts fresh while the pane is open, so the
  // stats and the assistant's snapshot can count session PRs.
  const sessions = useSessionsStore((s) => s.sessions);
  const ids = useMemo(() => sessions.filter((s) => !s.archivedAt).map((s) => s.id), [sessions]);
  const overview = useSessionsOverview(ids);
  return (
    <div className="orch-pane">
      <div className="orch-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="orch-body">
        {tab === "stats" ? <StatsView overview={overview} /> : <ChatView />}
      </div>
    </div>
  );
}
