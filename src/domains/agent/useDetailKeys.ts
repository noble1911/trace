import { useEffect, useRef } from "react";

/** Somewhere typing owns the keys — an input, or the terminal (xterm's textarea). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/**
 * A modal or popover menu is up — it owns Esc (and the user's attention), so
 * page-level shortcuts stand down. Checked against the DOM: a menu closing on
 * this same keydown is still mounted when the handler runs.
 */
export function overlayOpen(): boolean {
  return document.querySelector(".modal-backdrop, [role='menu']") !== null;
}

/**
 * A detail overlay's keys: Esc goes back (never from inside the terminal,
 * where Esc interrupts Claude, nor while a modal or menu is up), ⌘1–9 pick a tab.
 */
export function useDetailKeys<T extends string>(
  onBack: () => void,
  tabs: readonly T[],
  setTab: (tab: T) => void
): void {
  const ref = useRef({ onBack, tabs, setTab });
  ref.current = { onBack, tabs, setTab };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || overlayOpen()) return;
      const { onBack, tabs, setTab } = ref.current;
      if (e.metaKey && !e.shiftKey && e.key >= "1" && e.key <= "9") {
        const tab = tabs[Number(e.key) - 1];
        if (tab) {
          e.preventDefault();
          setTab(tab);
        }
        return;
      }
      if (e.key !== "Escape" || isTyping(e.target)) return;
      e.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
