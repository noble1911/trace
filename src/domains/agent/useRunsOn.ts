import { useCallback, useEffect, useState } from "react";
import { peerIdOf } from "@/domains/peers/hostChoices";
import { usePeerChoices } from "@/domains/peers/usePeerChoices";
import { useVercelStatus } from "@/domains/vercel/store";
import { issueHost, type RunsOn } from "@/ipc/agent";
import { useCapabilitiesStore } from "./capabilities";
import { agentHost } from "./defaults";
import { PEER_CHAT_BLOCK, type RunsOnState, SANDBOX_CHAT_BLOCK } from "./runsOn";

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

  const { choices } = usePeerChoices();
  // Where it ran last wins; else Settings' default, if that place is still on offer.
  const saved = agentHost();
  const savedOk =
    saved === "vercel" ? vercel !== null : choices.some((c) => c.host === saved && !c.reason);
  const fallback: RunsOn = ranOn !== "local" ? ranOn : savedOk ? saved : "local";
  const host = picked ?? fallback;
  const needsLogin = host === "vercel" && vercel !== null && !vercel.claude;
  const peerChoice = choices.find((c) => c.host === host);
  const chatBlock = needsLogin
    ? SANDBOX_CHAT_BLOCK
    : peerChoice && !peerChoice.canChat
      ? PEER_CHAT_BLOCK
      : undefined;
  return {
    picked,
    refresh,
    state: {
      host,
      offered: vercel !== null || choices.length > 0,
      sandboxOffered: vercel !== null,
      peers: choices,
      remote: ranOn !== "local",
      onPeer: peerIdOf(ranOn) !== null,
      chatBlock,
      choose: setPicked,
    },
  };
}
