import { InlineConfirm } from "@/components/InlineConfirm";
import type { PeerEntry } from "@/ipc/peers";
import { agentKindsLine, capabilityWords, stateWord } from "./peerList";
import { usePeersStore } from "./store";

function Detail({ label, value }: { label: string; value: string }) {
  return value ? (
    <div className="pr-detail">
      <span className="pr-detail-label">{label}</span>
      {value}
    </div>
  ) : null;
}

// One computer: its name, system and state, and for a ready one what it offers.
export function PeerRow({ peer }: { peer: PeerEntry }) {
  const forget = usePeersStore((s) => s.forget);
  const repos = peer.info?.repos.join(", ") ?? "";
  return (
    <li className="pr-peer">
      <div className="pr-peer-head">
        <span className="ig-device-name">{peer.name}</span>
        <span className="ig-device-meta">{peer.os ?? ""}</span>
        <span className={peer.state === "ready" ? "ig-device-on" : "ig-device-off"}>
          {stateWord(peer)}
        </span>
        {peer.id && (
          <InlineConfirm
            label="Forget"
            message={`Forget ${peer.name}?`}
            confirmLabel="Forget"
            className="btn xs"
            size="xs"
            onConfirm={() => void forget(peer.id ?? "")}
          />
        )}
      </div>
      <Detail label="Agents" value={agentKindsLine(peer)} />
      <Detail label="Repos" value={repos} />
      <Detail label="Can do" value={capabilityWords(peer).join(", ")} />
    </li>
  );
}
