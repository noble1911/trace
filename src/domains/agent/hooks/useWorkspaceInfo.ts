import { useEffect, useState } from "react";
import { onAgentTurn } from "@/ipc/events";
import { type WorkspaceInfo, workspaceInfo } from "@/ipc/workspace";

/**
 * A workspace's repo, worktree and live branch for the header and rail. Re-read
 * when one of its agents ends a turn (that's when a worktree appears or an agent
 * switches branch) and when `refreshKey` changes (e.g. the agent starts).
 */
export function useWorkspaceInfo(
  workspaceId: string,
  turnIds: string[] = [workspaceId],
  refreshKey: unknown = null
): WorkspaceInfo | null {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const turnKey = turnIds.join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is a deliberate re-read trigger
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      workspaceInfo(workspaceId)
        .then((i) => {
          if (!cancelled) setInfo(i);
        })
        .catch(() => {});
    };
    load();
    const ids = new Set(turnKey.split("\n"));
    let unlisten: (() => void) | undefined;
    void onAgentTurn((t) => {
      if (t.event === "stop" && ids.has(t.workspaceId)) load();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [workspaceId, turnKey, refreshKey]);

  return info;
}
