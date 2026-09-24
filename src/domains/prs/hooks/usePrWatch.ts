import { useCallback, useEffect, useMemo } from "react";
import { onAgentTurn } from "@/ipc/events";
import { prThread, workspacePrs } from "@/ipc/prWatch";
import { usePrWatchStore } from "../watchStore";

/** Re-read comments/checks this often while the view is visible… */
const THREAD_POLL_MS = 45_000;
/** …and this often while any check is still queued or running. */
const LIVE_POLL_MS = 15_000;
/** Re-scan the conversation/branch for new PRs this often (turn ends also trigger it). */
const DISCOVER_POLL_MS = 120_000;

const NO_URLS: string[] = [];

/** Re-scan a workspace for PRs now (e.g. right after raising one). */
export function discoverPrs(workspaceId: string): Promise<void> {
  return workspacePrs(workspaceId)
    .then((found) => usePrWatchStore.getState().setLinks(workspaceId, found))
    .catch(() => {
      // Discovery is best-effort (no repo yet, gh missing) — keep what we had.
    });
}

/**
 * Keep a workspace's PRs fresh while the calling view is mounted: discover them
 * (branch + conversation), then poll each PR's discussion. Discovery re-runs
 * whenever one of `turnIds`' agents ends a turn — the moment a freshly raised
 * PR shows up. Polling pauses while the window is hidden and catches up on focus.
 *
 * `extraUrls` are PRs known from elsewhere (Jira's dev-status) — merged in.
 * Returns the PR URLs, discovered first.
 */
export function usePrWatch(
  workspaceId: string,
  turnIds: string[] = [workspaceId],
  extraUrls: string[] = NO_URLS
): string[] {
  const discovered = usePrWatchStore((s) => s.links[workspaceId] ?? NO_URLS);
  const extraKey = extraUrls.join("\n");
  const urls = useMemo(
    () => [...new Set([...discovered, ...(extraKey ? extraKey.split("\n") : [])])],
    [discovered, extraKey]
  );

  const discover = useCallback(() => void discoverPrs(workspaceId), [workspaceId]);

  const turnKey = turnIds.join("\n");
  useEffect(() => {
    discover();
    const timer = window.setInterval(discover, DISCOVER_POLL_MS);
    const ids = new Set(turnKey.split("\n"));
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void onAgentTurn((t) => {
      if (t.event === "stop" && ids.has(t.workspaceId)) discover();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unlisten?.();
    };
  }, [discover, turnKey]);

  const urlKey = urls.join("\n");
  // Checks change by the minute while CI runs; comments don't — poll faster
  // only while some watched PR has a check in flight.
  const checksLive = usePrWatchStore((s) =>
    urls.some((u) =>
      s.threads[u]?.checkRuns.some((c) => c.state === "running" || c.state === "queued")
    )
  );
  const pollMs = checksLive ? LIVE_POLL_MS : THREAD_POLL_MS;
  useEffect(() => {
    if (!urlKey) return;
    const list = urlKey.split("\n");
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      for (const url of list) {
        prThread(workspaceId, url)
          .then((t) => usePrWatchStore.getState().setThread(url, t))
          .catch((e) => usePrWatchStore.getState().setError(url, String(e)));
      }
    };
    refresh();
    const timer = window.setInterval(refresh, pollMs);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [workspaceId, urlKey, pollMs]);

  return urls;
}
