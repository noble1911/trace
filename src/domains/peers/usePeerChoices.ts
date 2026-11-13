import { useEffect, useMemo } from "react";
import { type PeerChoice, peerChoices } from "./hostChoices";
import { usePeersStore } from "./store";

/**
 * The paired peers as places to run, for the "Run on" picker. Reads the list once if
 * nobody has yet (the Peers section keeps it fresh when it's open), so a picker never
 * shows a stale "ready" for long: opening Settings → Peers or its Look again refreshes.
 */
export function usePeerChoices(): { choices: PeerChoice[]; refresh: () => void } {
  const peers = usePeersStore((s) => s.peers);
  const discover = usePeersStore((s) => s.discover);
  useEffect(() => {
    if (peers === null) void discover();
  }, [peers, discover]);
  const choices = useMemo(() => peerChoices(peers), [peers]);
  return { choices, refresh: () => void discover() };
}
