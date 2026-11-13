import { invoke } from "@tauri-apps/api/core";

// Other traces on the tailnet (`commands/peers.rs`): finding them, pairing, and this
// computer's own server switch. Pairing tokens stay in Rust. The one exception is the
// code the user asks to see to hand to another computer: show it, never keep it.

/** What a peer's server offers, from its `Welcome`. */
export interface PeerCapabilities {
  turnHooks: boolean;
  transcript: boolean;
  files: boolean;
  terminal: boolean;
  tests: boolean;
  agentTools: boolean;
  chat: boolean;
}

export interface PeerInfo {
  hostName: string;
  protocol: number;
  capabilities: PeerCapabilities;
  os: string | null;
  /** "claude", "codex". */
  agentKinds: string[];
  /** Repo display names, never paths. */
  repos: string[];
}

/** ready: paired and answering. away: paired, offline or its server is off.
 *  refused: paired, but its token changed. unpaired: a trace answered; not paired yet. */
export type PeerState = "ready" | "away" | "refused" | "unpaired";

export interface PeerEntry {
  /** Set once paired. */
  id: string | null;
  name: string;
  address: string;
  os: string | null;
  online: boolean;
  state: PeerState;
  info: PeerInfo | null;
}

export interface PeerSummary {
  id: string;
  name: string;
  address: string;
}

export function peerList(): Promise<PeerEntry[]> {
  return invoke("peer_list");
}

/** This computer's pairing code, for another computer to paste. */
export function peerPairCode(): Promise<string> {
  return invoke("peer_pair_code");
}

/** New token: codes already given out stop working, paired computers must pair again. */
export function peerRotateToken(): Promise<void> {
  return invoke("peer_rotate_token");
}

export function peerPair(code: string): Promise<PeerSummary> {
  return invoke("peer_pair", { code });
}

export function peerForget(id: string): Promise<void> {
  return invoke("peer_forget", { id });
}

export function getPeerServer(): Promise<boolean> {
  return invoke("get_peer_server");
}

export function setPeerServer(enabled: boolean): Promise<void> {
  return invoke("set_peer_server", { enabled });
}
