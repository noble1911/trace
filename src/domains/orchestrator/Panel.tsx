import { I } from "@/components/Icon";
import { ChatView } from "./ChatView";
import { usePanelResize } from "./hooks/usePanelResize";
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
  const { size, resizing, startResize, onHandleKey, resetSize } = usePanelResize();

  if (!open) return null;

  return (
    <div
      className={`orch-panel${resizing ? " resizing" : ""}`}
      role="dialog"
      aria-label="Orchestrator"
      // Dynamic: the panel's size is dragged by the user (see usePanelResize).
      style={{ width: size.width, height: size.height }}
    >
      {/* Grab handles on the two free edges — the other two are pinned to the
          bottom-right corner. Buttons (not bare divs) so they're focusable and
          the arrow keys work; double-click restores the default size. */}
      <button
        type="button"
        className="orch-resize left"
        aria-label="Resize panel width"
        onPointerDown={startResize("left")}
        onKeyDown={onHandleKey("left")}
        onDoubleClick={resetSize}
        title="Drag or use ←/→ to resize"
      />
      <button
        type="button"
        className="orch-resize top"
        aria-label="Resize panel height"
        onPointerDown={startResize("top")}
        onKeyDown={onHandleKey("top")}
        onDoubleClick={resetSize}
        title="Drag or use ↑/↓ to resize"
      />
      <button
        type="button"
        className="orch-resize corner"
        aria-label="Resize panel"
        onPointerDown={startResize("corner")}
        onKeyDown={onHandleKey("corner")}
        onDoubleClick={resetSize}
        title="Drag or use arrow keys · double-click to reset"
      />
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

      <div className="orch-body">{tab === "stats" ? <StatsView /> : <ChatView />}</div>
    </div>
  );
}
