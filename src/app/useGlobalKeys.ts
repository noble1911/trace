import { useEffect } from "react";
import { useBoardStore } from "@/domains/board/store";
import { orderIds } from "@/domains/live/order";
import { useLiveStore } from "@/domains/live/store";
import { useOrchestratorStore } from "@/domains/orchestrator/store";
import { useSessionsStore } from "@/domains/sessions/store";
import type { NavId } from "./nav";
import { openWorkspace } from "./openWorkspace";

/**
 * The next agent that needs you, in list order, after the one open now —
 * wrapping round — or null when nothing does.
 */
export function nextNeedingYou(): string | null {
  const { info, manualOrder } = useLiveStore.getState();
  const order = orderIds(Object.keys(info), (id) => info[id].openedAt, manualOrder);
  const needs = order.filter((id) => info[id].light === "attention");
  if (needs.length === 0) return null;
  const current =
    useBoardStore.getState().selectedIssueKey ?? useSessionsStore.getState().selectedAgentId;
  const at = current ? order.indexOf(current) : -1;
  return needs.find((id) => order.indexOf(id) > at && id !== current) ?? needs[0];
}

/** App-wide shortcuts: ⌘J orchestrator, ⌘⇧N jump to the next agent needing you. */
export function useGlobalKeys(setNav: (nav: NavId) => void): void {
  const toggleOrchestrator = useOrchestratorStore((s) => s.toggle);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "j" && !e.shiftKey) {
        e.preventDefault();
        toggleOrchestrator();
      } else if (e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const next = nextNeedingYou();
        if (next) openWorkspace(next, setNav);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleOrchestrator, setNav]);
}
