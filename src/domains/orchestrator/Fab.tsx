import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { useOrchestratorStore } from "./store";

// The floating "Orchestrator" button (bottom-right). Opens the panel; shows a
// badge of agents waiting on you. ⌘J toggles it (the listener lives in App so
// it works whether the FAB or the panel is mounted — ⌘K/⌘/ are taken by search).
export function OrchestratorFab() {
  const open = useOrchestratorStore((s) => s.open);
  const setOpen = useOrchestratorStore((s) => s.setOpen);
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const ackedWaiting = useBoardStore((s) => s.ackedWaiting);

  const waitingCount = [...runningAgents].filter(
    (k) => !k.startsWith("term:") && agentActivity[k] === "waiting" && !ackedWaiting.has(k)
  ).length;

  if (open) return null;

  return (
    <button type="button" className="orch-fab" onClick={() => setOpen(true)}>
      <span className="glow">
        <I.Sparkles size={12} />
      </span>
      <span style={{ fontWeight: 500 }}>Orchestrator</span>
      {waitingCount > 0 && (
        <span className="orch-fab-badge">
          {waitingCount} need{waitingCount === 1 ? "s" : ""} you
        </span>
      )}
      <kbd>⌘ J</kbd>
    </button>
  );
}
