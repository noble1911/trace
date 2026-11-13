import { create } from "zustand";
import { useBoardStore } from "@/domains/board/store";
import { isScheduledRun } from "@/domains/schedules/ids";
import { agentWorkspaceIds } from "@/domains/sessions/agentRoster";
import { useSessionsStore } from "@/domains/sessions/store";
import { loadUnread, saveUnread } from "./prefs";
import { useLiveStore } from "./store";
import { finishedTurns, pruneUnread, withoutUnread, withUnread } from "./unread";

// Which sessions have news since the user last opened them (`unread.ts`), kept
// apart from the board store's acknowledgements on purpose: those are per agent
// and settle a light (dismissing from the Inbox acks without opening anything),
// while this is per session and only opening the session clears it. Persisted
// (a few ids in localStorage, beside the live lists' order) so a session that
// finished overnight is still bold after a restart. The sessions-store import
// is circular through the board store; both sides only use it inside functions.

interface UnreadStore {
  /** Session ids, oldest news first. */
  ids: readonly string[];
  set: (ids: readonly string[]) => void;
}

export const useUnreadStore = create<UnreadStore>((set) => ({
  ids: loadUnread(),
  set(ids) {
    saveUnread(ids);
    set({ ids });
  },
}));

function update(change: (ids: readonly string[]) => readonly string[]) {
  const { ids, set } = useUnreadStore.getState();
  const next = change(ids);
  if (next !== ids) set(next);
}

/** Whether this session has a finished turn the user hasn't opened since. */
export function useSessionUnread(sessionId: string): boolean {
  return useUnreadStore((s) => s.ids.includes(sessionId));
}

/** The session the user is looking at right now, if any. */
function watchedSession(): string | null {
  return document.hasFocus() ? useSessionsStore.getState().selectedId : null;
}

/**
 * Keep the unread list in step: a finished turn marks its session unless the
 * user is looking at it; opening a session (or coming back to the window with
 * it open) clears it; deleted sessions drop out. Returns the unsubscribe.
 */
export function watchUnread(): () => void {
  const offLive = useLiveStore.subscribe((s, prev) => {
    if (s.info === prev.info) return;
    // Unseen = the user hasn't looked since the turn ended; a scheduled run's
    // pauses are the runner's business, not news.
    const { ackedWaiting } = useBoardStore.getState();
    const done = finishedTurns(
      prev.info,
      s.info,
      (id) => !ackedWaiting.has(id) && !isScheduledRun(id)
    );
    if (done.length === 0) return;
    const { sessions } = useSessionsStore.getState();
    const watched = watchedSession();
    const owners = done
      .map((id) => sessions.find((x) => agentWorkspaceIds(x).includes(id))?.id)
      .filter((id): id is string => id !== undefined && id !== watched);
    update((ids) => withUnread(ids, owners));
  });
  const offSessions = useSessionsStore.subscribe((s, prev) => {
    const opened = s.selectedId;
    if (opened && opened !== prev.selectedId) update((ids) => withoutUnread(ids, opened));
    if (s.sessions !== prev.sessions) {
      const known = s.sessions.map((x) => x.id);
      update((ids) => pruneUnread(ids, known));
    }
  });
  const onFocus = () => {
    const opened = useSessionsStore.getState().selectedId;
    if (opened) update((ids) => withoutUnread(ids, opened));
  };
  window.addEventListener("focus", onFocus);
  return () => {
    offLive();
    offSessions();
    window.removeEventListener("focus", onFocus);
  };
}

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
