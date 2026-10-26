import { ChatView } from "./ChatView";
import { StatsView } from "./StatsView";
import { type OrchTab, useOrchestratorStore } from "./store";

const TABS: { id: OrchTab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "chat", label: "Chat" },
];

// The orchestrator, as a view of the right-edge side panel: the board overview
// (Stats) and the assistant (Chat). Its tab and the conversation live in stores,
// so moving between the board, sessions and a ticket keeps your place.
export function OrchestratorPane() {
  const tab = useOrchestratorStore((s) => s.tab);
  const setTab = useOrchestratorStore((s) => s.setTab);
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
      <div className="orch-body">{tab === "stats" ? <StatsView /> : <ChatView />}</div>
    </div>
  );
}
