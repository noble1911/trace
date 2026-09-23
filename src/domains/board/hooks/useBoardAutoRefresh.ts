import { useEffect } from "react";
import { boardOptionFor } from "@/domains/issues/store";
import { getBoard } from "@/ipc/issues";
import { useBoardStore } from "../store";

/** Re-read the board this often while the window is visible. */
const SYNC_MS = 30_000;
/** A focus within this long of the last sync doesn't trigger another. */
const FOCUS_MIN_GAP_MS = 10_000;

let lastSync = 0;

/**
 * Pull the current board without the manual refresh's side effects: no loading
 * state (the board doesn't blank) and PR badges are kept. A result is dropped if
 * the board changed underneath it — the user switched boards, or dragged a card
 * (its optimistic move must not be snapped back by a response that predates it).
 */
async function syncBoard(): Promise<void> {
  const { boardKey, data, loading } = useBoardStore.getState();
  const option = boardOptionFor(boardKey);
  if (!option || !data || loading) return;
  lastSync = Date.now();
  try {
    const fresh = await getBoard(option.provider, option.boardId);
    const now = useBoardStore.getState();
    if (now.boardKey === boardKey && now.data === data) useBoardStore.setState({ data: fresh });
  } catch {
    // Transient (offline, rate-limited) — the next tick retries; the manual
    // refresh is still there to surface a real error.
  }
}

/**
 * Keep the board in step with the tracker — issues move, get assigned or
 * created outside trace. Syncs every 30s while visible and on window focus.
 */
export function useBoardAutoRefresh(): void {
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void syncBoard();
    };
    const onFocus = () => {
      if (Date.now() - lastSync >= FOCUS_MIN_GAP_MS) void syncBoard();
    };
    const timer = window.setInterval(tick, SYNC_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
