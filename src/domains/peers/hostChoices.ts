import type { PeerEntry } from "../../ipc/peers.ts";

// The paired peers as places an agent can run: the rows of the "Run on" picker, and the
// name a host badge shows. Pure (relative `.ts` imports) so `npm test` can run it.

/** A host id for a peer: `peer:<id>`, the string the backend takes as `host`. */
export type PeerHostId = `peer:${string}`;

const PREFIX = "peer:";

export function peerHostId(peerId: string): PeerHostId {
  return `${PREFIX}${peerId}`;
}

/** The peer id inside a host id, or null for `local`, `vercel` or anything else. */
export function peerIdOf(host: string): string | null {
  return host.startsWith(PREFIX) && host.length > PREFIX.length ? host.slice(PREFIX.length) : null;
}

/** One peer in the picker. A `reason` means it can't be picked, and says why. */
export interface PeerChoice {
  host: PeerHostId;
  name: string;
  /** What it can be picked for: "Ready", or why not. */
  detail: string;
  /** Its server can show an agent as a chat (the protocol is terminal-only for now). */
  canChat: boolean;
  /** The agents it runs: "claude", "codex". */
  agentKinds: string[];
  /** The repos it offers, by display name. */
  repos: string[];
  reason?: string;
}

/** Why a peer can't be picked; null when it can. Words match the Settings section. */
function blockReason(peer: PeerEntry): string | null {
  if (!peer.id) return "Not paired. Pair it in Settings → Peers";
  switch (peer.state) {
    case "ready":
      return null;
    case "away":
      return peer.online ? "Its trace server is off" : "Offline";
    case "refused":
      return "Pairing changed. Pair again in Settings → Peers";
    case "unpaired":
      return "Not paired. Pair it in Settings → Peers";
  }
}

/** Paired peers (and the unpaired ones found, so the user sees why they're not on offer). */
export function peerChoices(peers: PeerEntry[] | null): PeerChoice[] {
  return (peers ?? []).flatMap((p) => {
    const reason = blockReason(p);
    // An unpaired device has no id to start on; it's listed in Settings, not here.
    if (!p.id) return [];
    return [
      {
        host: peerHostId(p.id),
        name: p.name,
        detail: reason ?? "Ready",
        canChat: p.info?.capabilities.chat === true,
        agentKinds: p.info?.agentKinds ?? [],
        repos: p.info?.repos ?? [],
        ...(reason ? { reason } : {}),
      },
    ];
  });
}

/** The name a badge shows for a peer id; falls back to a short id when it isn't listed. */
export function peerName(peers: PeerEntry[] | null, peerId: string): string {
  return peers?.find((p) => p.id === peerId)?.name ?? `peer ${peerId.slice(0, 6)}`;
}

/** The peer entry a host id names, if listed. */
export function peerFor(peers: PeerEntry[] | null, host: string): PeerEntry | undefined {
  const id = peerIdOf(host);
  return id ? peers?.find((p) => p.id === id) : undefined;
}
