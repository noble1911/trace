import { invoke } from "@tauri-apps/api/core";

// The peer server (`commands/peer_server.rs`): this trace listening on its Tailscale
// address so other traces on the tailnet can start and watch sessions here.

export interface PeerServerStatus {
  enabled: boolean;
  port: number;
  /** `ip:port` while listening. */
  listening: string | null;
  /** Why it isn't listening, when it's on but not. */
  waitingFor: string | null;
  clients: number;
}

export function peerServerStatus(): Promise<PeerServerStatus> {
  return invoke("peer_server_status");
}

export function setPeerServer(args: {
  enabled?: boolean;
  port?: number;
}): Promise<PeerServerStatus> {
  return invoke("set_peer_server", args);
}
