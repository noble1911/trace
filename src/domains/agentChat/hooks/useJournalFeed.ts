import { useEffect } from "react";
import { toast } from "@/app/toast";
import { onAgentJournal, onAgentSessionInfo } from "@/ipc/agentChat";
import { useChatActions } from "../actions";
import { noteChatInfo, noteChatRows } from "../liveBridge";
import { useAgentChatStore } from "../store";
import { createListenerStarter, loadJournalOnce } from "./journalLoad";

// Keeps the store fed: one app-wide subscription to `agent-journal` and
// `agent-session-info` (started with the app, never torn down, so rows for
// agents not on screen still land and reach the board via `liveBridge`), and
// each view's saved journal read once.
// Rows from the load and from events can interleave; upserting by revision makes
// the order irrelevant.

/** Workspaces whose saved journal was read; a failed read is retried on the next mount. */
const fetched = new Set<string>();

/** Start the app-wide event subscriptions (idempotent, each retried only if it failed). */
export const ensureChatListeners = createListenerStarter({
  onJournal: onAgentJournal,
  onInfo: onAgentSessionInfo,
  handleJournal: (e) => {
    const { applyRows, resetRows } = useAgentChatStore.getState();
    if (e.reset) resetRows(e.workspaceId, e.rows);
    else applyRows(e.workspaceId, e.rows);
    noteChatRows(e.workspaceId, e.rows);
  },
  handleInfo: (e) => {
    noteChatInfo(e.workspaceId, e.info);
    useAgentChatStore.getState().setInfo(e.workspaceId, e.info);
  },
  fail: (which, e) => toast.error(`Couldn't listen for ${which}: ${String(e)}`),
});

/** Load `workspaceId`'s saved journal and keep it current. */
export function useJournalFeed(workspaceId: string): void {
  const actions = useChatActions();
  useEffect(() => {
    ensureChatListeners();
    if (fetched.has(workspaceId)) return;
    let cancelled = false;
    const { applyRows, markLoaded } = useAgentChatStore.getState();
    void loadJournalOnce(
      workspaceId,
      fetched,
      {
        load: actions.load,
        applyRows,
        markLoaded,
        noteRows: noteChatRows,
        fail: (e) => toast.error(`Couldn't read the conversation: ${String(e)}`),
      },
      () => cancelled
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, actions]);
}
