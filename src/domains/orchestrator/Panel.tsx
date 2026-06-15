import { I } from "@/components/Icon";
import { StatsView } from "./StatsView";
import { type OrchTab, useOrchestratorStore } from "./store";

const TABS: { id: OrchTab; label: string }[] = [
  { id: "stats", label: "Stats" },
  { id: "chat", label: "Chat" },
];

// The slide-out orchestrator panel: a Stats overview now, the AI assistant in
// the Chat tab (Phase 2). Class names ported from the design's orch-panel.
export function OrchestratorPanel() {
  const open = useOrchestratorStore((s) => s.open);
  const tab = useOrchestratorStore((s) => s.tab);
  const setOpen = useOrchestratorStore((s) => s.setOpen);
  const setTab = useOrchestratorStore((s) => s.setTab);

  if (!open) return null;

  return (
    <div className="orch-panel" role="dialog" aria-label="Orchestrator">
      <div className="head">
        <span className="glow">
          <I.Sparkles size={11} />
        </span>
        <div>
          <div className="title">Orchestrator</div>
          <div className="sub">board overview</div>
        </div>
        <button type="button" className="x" onClick={() => setOpen(false)} aria-label="Close">
          <I.X size={14} />
        </button>
      </div>

      <div className="orch-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="orch-body">{tab === "stats" ? <StatsView /> : <ChatPlaceholder />}</div>
    </div>
  );
}

function ChatPlaceholder() {
  return (
    <div className="orch-empty orch-chat-soon">
      <I.Sparkles size={24} />
      <div className="t">The assistant is coming soon</div>
      <div className="h">
        It'll read the board, suggest what to play next, and act on your say-so.
      </div>
    </div>
  );
}
