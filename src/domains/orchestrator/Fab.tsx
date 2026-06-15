import { I } from "@/components/Icon";
import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";
import { useOrchestratorStore } from "./store";

// The floating "Orchestrator" button (bottom-right). The main pill opens the
// panel (⌘J — the listener lives in App so it works whether the FAB or the panel
// is mounted; ⌘K/⌘/ are taken by search). When agents are waiting on you, the
// badge becomes a shortcut straight to one.
export function OrchestratorFab() {
  const open = useOrchestratorStore((s) => s.open);
  const setOpen = useOrchestratorStore((s) => s.setOpen);
  const runningAgents = useBoardStore((s) => s.runningAgents);
  const agentActivity = useBoardStore((s) => s.agentActivity);
  const ackedWaiting = useBoardStore((s) => s.ackedWaiting);

  const waiting = [...runningAgents].filter(
    (k) => !k.startsWith("term:") && agentActivity[k] === "waiting" && !ackedWaiting.has(k)
  );

  if (open) return null;

  // Jump to a waiting agent — a Jira issue opens its card detail, otherwise an
  // exploratory session. Viewing it acks the wait (see Agent/SessionDetail), so
  // repeated clicks walk through the queue. Mirrors the notification jump.
  const jumpToWaiting = () => {
    const target = waiting[0];
    if (!target) return;
    const isIssue = useBoardStore.getState().data?.issues.some((i) => i.key === target);
    if (isIssue) useBoardStore.getState().openIssue(target);
    else useSessionsStore.getState().select(target);
  };

  return (
    <div className="orch-fab">
      <button type="button" className="orch-fab-main" onClick={() => setOpen(true)}>
        <span className="glow">
          <I.Sparkles size={12} />
        </span>
        <span className="orch-fab-label">Orchestrator</span>
        <kbd>⌘ J</kbd>
      </button>
      {waiting.length > 0 && (
        <button
          type="button"
          className="orch-fab-badge"
          onClick={jumpToWaiting}
          title="Go to the agent waiting on you"
        >
          {waiting.length} need{waiting.length === 1 ? "s" : ""} you →
        </button>
      )}
    </div>
  );
}
