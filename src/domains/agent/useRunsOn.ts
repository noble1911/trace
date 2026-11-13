import { useCallback, useEffect, useState } from "react";
import { useVercelStatus } from "@/domains/vercel/store";
import { issueHost, type RunsOn } from "@/ipc/agent";
import { useCapabilitiesStore } from "./capabilities";
import { agentHost } from "./defaults";
import { type RunsOnState, SANDBOX_CHAT_BLOCK } from "./runsOn";

/**
 * Where `issueKey`'s next start runs: the menu's pick, else where it ran last, else
 * Settings' default (this machine when Vercel isn't connected). `refresh` re-reads
 * where it runs after a start, since that's when the backend records it.
 */
export function useRunsOn(issueKey: string): {
  state: RunsOnState;
  /** The menu's pick, to hand to the start; undefined lets the default apply. */
  picked: RunsOn | undefined;
  refresh: () => void;
} {
  const vercel = useVercelStatus();
  const [ranOn, setRanOn] = useState<RunsOn>("local");
  const [picked, setPicked] = useState<RunsOn | undefined>();
  const reloadCaps = useCapabilitiesStore((s) => s.reload);

  const refresh = useCallback(() => {
    void issueHost(issueKey)
      .then(setRanOn)
      .catch(() => {});
    void reloadCaps(issueKey);
  }, [issueKey, reloadCaps]);
  useEffect(() => {
    setPicked(undefined);
    refresh();
  }, [refresh]);

  const fallback: RunsOn = ranOn === "vercel" ? "vercel" : vercel ? agentHost() : "local";
  const host = picked ?? fallback;
  const needsLogin = host === "vercel" && vercel !== null && !vercel.claude;
  return {
    picked,
    refresh,
    state: {
      host,
      offered: vercel !== null,
      remote: ranOn === "vercel",
      chatBlock: needsLogin ? SANDBOX_CHAT_BLOCK : undefined,
      choose: setPicked,
    },
  };
}
