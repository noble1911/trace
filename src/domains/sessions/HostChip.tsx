import { peerName } from "@/domains/peers/hostChoices";
import { usePeersStore } from "@/domains/peers/store";
import type { SessionHost } from "./types";

/**
 * Where a session runs when it isn't this computer: "Vercel", or the peer's name, in a
 * chip of its own (`.session-host`) so it reads as a place, not an agent type like Codex.
 * Its tooltip says what being there means for leaving and stopping it.
 */
export function HostChip({ host }: { host: SessionHost }) {
  const peers = usePeersStore((s) => s.peers);
  if (host.kind === "peer") {
    const name = peerName(peers, host.peer);
    return (
      <span className="session-host" title={`Runs on ${name}, another computer running trace.`}>
        {name}
      </span>
    );
  }
  const title = `Runs in the Vercel Sandbox ${host.sandbox}, not on this computer. Leave running keeps Claude working there; Stop & save ends it and keeps a snapshot for Start to resume.`;
  return (
    <span className="session-host" title={title}>
      Vercel
    </span>
  );
}
