import { useEffect, useRef } from "react";
import { isTyping, overlayOpen } from "@/domains/agent/useDetailKeys";
import { useBoardStore } from "@/domains/board/store";
import { useSessionsStore } from "@/domains/sessions/store";

export interface InboxKeyActions {
  move: (by: -1 | 1) => void;
  nudge: (by: -1 | 1) => void;
  open: () => void;
  markSeen: () => void;
  /** 1–3: pick that answer on the selected agent's prompt. */
  answer: (index: number) => void;
}

/** Arrow keys belong to the list only when it (or nothing) has focus — else they scroll. */
function inList(target: EventTarget | null): boolean {
  return (
    target === document.body ||
    (target instanceof HTMLElement && target.closest(".ib-list") !== null)
  );
}

/**
 * The inbox's keyboard: J/K (or ↑/↓ in the list) move, ⌥↑/⌥↓ reorder, ⏎ opens,
 * E marks seen, 1–3 answer. Inactive while typing, while a modal or menu is up,
 * and while a detail overlay covers the inbox.
 */
export function useInboxKeys(actions: InboxKeyActions): void {
  // A ref so the listener is registered once but always calls the latest actions.
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.defaultPrevented || isTyping(e.target)) return;
      if (overlayOpen()) return;
      if (useBoardStore.getState().selectedIssueKey || useSessionsStore.getState().selectedId) {
        return;
      }
      const a = ref.current;
      const arrow = e.key === "ArrowDown" || e.key === "ArrowUp";
      if (arrow && !inList(e.target)) return;
      const down = e.key === "j" || e.key === "ArrowDown";
      const up = e.key === "k" || e.key === "ArrowUp";
      if ((down || up) && e.altKey) a.nudge(down ? 1 : -1);
      else if (down || up) a.move(down ? 1 : -1);
      else if (e.key === "Enter") {
        // A focused button (an answer, a tab) takes its own Enter. Rows are divs.
        if (e.target instanceof HTMLButtonElement) return;
        a.open();
      } else if (e.key === "e") a.markSeen();
      else if (e.key >= "1" && e.key <= "3") {
        if (e.target instanceof HTMLButtonElement) return;
        a.answer(Number(e.key) - 1);
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
