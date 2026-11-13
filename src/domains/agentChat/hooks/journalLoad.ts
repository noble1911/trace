import type { JournalEvent, JournalRow, SessionInfoEvent } from "../types.ts";

// The logic of `useJournalFeed`, with its Tauri, store and toast ends passed in
// so it runs under node's test runner.

export interface LoadDeps {
  load: (workspaceId: string) => Promise<JournalRow[]>;
  applyRows: (workspaceId: string, rows: JournalRow[]) => void;
  markLoaded: (workspaceId: string) => void;
  /** A running agent's prompt still open from before the view (or a reload). */
  noteRows: (workspaceId: string, rows: JournalRow[]) => void;
  fail: (error: unknown) => void;
}

/**
 * Read `workspaceId`'s saved journal once. A read that finishes lands in full even
 * if the view has gone (the store is keyed by workspace): "fetched" only ever means
 * the rows are in. A failure is reported, and retried on the next mount, only
 * while the view is still there.
 */
export async function loadJournalOnce(
  workspaceId: string,
  fetched: Set<string>,
  deps: LoadDeps,
  isCancelled: () => boolean
): Promise<void> {
  try {
    const rows = await deps.load(workspaceId);
    fetched.add(workspaceId);
    deps.applyRows(workspaceId, rows);
    deps.noteRows(workspaceId, rows);
    deps.markLoaded(workspaceId);
  } catch (e) {
    if (isCancelled()) return;
    deps.fail(e);
    deps.markLoaded(workspaceId);
  }
}

export interface ListenerDeps {
  onJournal: (cb: (e: JournalEvent) => void) => Promise<unknown>;
  onInfo: (cb: (e: SessionInfoEvent) => void) => Promise<unknown>;
  handleJournal: (e: JournalEvent) => void;
  handleInfo: (e: SessionInfoEvent) => void;
  fail: (which: "agent-journal" | "agent-session-info", error: unknown) => void;
}

/**
 * Start the two app-wide subscriptions, each at most once: one that failed to
 * register is tried again on the next call, and one that succeeded never is.
 */
export function createListenerStarter(deps: ListenerDeps): () => void {
  const state = { journal: false, info: false };
  return () => {
    if (!state.journal) {
      state.journal = true;
      deps.onJournal(deps.handleJournal).catch((e) => {
        state.journal = false;
        deps.fail("agent-journal", e);
      });
    }
    if (!state.info) {
      state.info = true;
      deps.onInfo(deps.handleInfo).catch((e) => {
        state.info = false;
        deps.fail("agent-session-info", e);
      });
    }
  };
}
