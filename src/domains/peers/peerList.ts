import type { PeerCapabilities, PeerEntry, PeerState } from "@/ipc/peers";

// The peer list's pure state: how a fresh answer replaces the old one, and the words
// a row uses. The store wraps these; they're tested on their own.

export interface PeerListState {
  /** Null until the first discovery finishes. */
  peers: PeerEntry[] | null;
  /** The last discovery failed outright (not "found nobody"). */
  failed: boolean;
}

export const EMPTY_PEERS: PeerListState = { peers: null, failed: false };

/** A discovery answer replaces the list; a failure keeps the last list but says so. */
export function applyDiscovery(prev: PeerListState, answer: PeerEntry[] | Error): PeerListState {
  if (answer instanceof Error) return { peers: prev.peers, failed: true };
  return { peers: answer, failed: false };
}

/** Forgetting drops the row at once; the next discovery may list the device again as unpaired. */
export function withoutPeer(prev: PeerListState, id: string): PeerListState {
  return { ...prev, peers: prev.peers?.filter((p) => p.id !== id) ?? null };
}

const STATE_WORD: Record<PeerState, string> = {
  ready: "Ready",
  away: "Not answering",
  refused: "Pair again",
  unpaired: "Not paired",
};

export function stateWord(peer: PeerEntry): string {
  if (peer.state === "away" && !peer.online) return "Offline";
  return STATE_WORD[peer.state];
}

/** The picker will only offer ready peers. */
export function readyPeers(peers: PeerEntry[] | null): PeerEntry[] {
  return (peers ?? []).filter((p) => p.state === "ready");
}

const CAPABILITY_WORD: [keyof PeerCapabilities, string][] = [
  ["terminal", "Terminal"],
  ["files", "Files"],
  ["transcript", "Transcript"],
  ["tests", "Tests"],
  ["agentTools", "Agent tools"],
  ["chat", "Chat"],
];

/** What a ready peer can do, as words; empty for one that isn't answering. */
export function capabilityWords(peer: PeerEntry): string[] {
  const caps = peer.info?.capabilities;
  if (!caps) return [];
  return CAPABILITY_WORD.filter(([key]) => caps[key]).map(([, word]) => word);
}

/** "Claude, Codex": the agents it runs. */
export function agentKindsLine(peer: PeerEntry): string {
  return (peer.info?.agentKinds ?? [])
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join(", ");
}
