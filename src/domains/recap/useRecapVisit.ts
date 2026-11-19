import { useEffect } from "react";
import { markRecapSeen } from "@/ipc/recaps";
import { requestRecap } from "./engine";
import { useRecapStore } from "./store";
import { hasRecap } from "./types";

// Opening a ticket's or session's detail: record the visit, so "Since you looked"
// knows when the user was last here (and that they've seen it once they leave),
// and give a workspace with no recap yet (one from before recaps, or whose last
// try failed) its first one.

/** A remount this soon after leaving is the same visit (StrictMode, a quick switch back). */
const LEAVE_GRACE_MS = 1_500;
const leaving = new Map<string, ReturnType<typeof setTimeout>>();

async function markSeen(workspaceId: string, at: number): Promise<number> {
  try {
    return await markRecapSeen(workspaceId, at);
  } catch {
    return 0;
  }
}

/** Mount in a detail view, with the agent it shows. */
export function useRecapVisit(workspaceId: string): void {
  useEffect(() => {
    const pending = leaving.get(workspaceId);
    if (pending !== undefined) {
      clearTimeout(pending);
      leaving.delete(workspaceId);
    } else {
      const start = Date.now();
      void markSeen(workspaceId, start).then((before) => {
        useRecapStore.getState().setVisit(workspaceId, { before, start });
      });
    }
    return () => {
      leaving.set(
        workspaceId,
        setTimeout(() => {
          leaving.delete(workspaceId);
          void markSeen(workspaceId, Date.now());
        }, LEAVE_GRACE_MS)
      );
    };
  }, [workspaceId]);

  const loaded = useRecapStore((s) => s.loaded);
  const recapped = useRecapStore((s) => hasRecap(s.recaps[workspaceId]));
  useEffect(() => {
    if (loaded && !recapped) requestRecap(workspaceId, { delay: 0 });
  }, [loaded, recapped, workspaceId]);
}
