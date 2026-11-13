import { create } from "zustand";
import {
  getPeerServer,
  type PeerEntry,
  peerForget,
  peerList,
  peerPair,
  setPeerServer,
} from "@/ipc/peers";
import { applyDiscovery, EMPTY_PEERS, type PeerListState, withoutPeer } from "./peerList";

// Other traces on the tailnet: who's there, who this computer is paired with, and
// whether it serves as a host itself. The list is filled by discovery (Rust probes
// each device); the rules for replacing it live in `peerList.ts`.

interface PeersStore extends PeerListState {
  searching: boolean;
  /** Server mode, as saved. Null until read. */
  serverOn: boolean | null;
  discover: () => Promise<void>;
  /** Pair from a pasted code. Resolves with an error message, or null on success. */
  pair: (code: string) => Promise<string | null>;
  forget: (id: string) => Promise<void>;
  loadServer: () => Promise<void>;
  setServer: (on: boolean) => Promise<void>;
}

export const usePeersStore = create<PeersStore>((set, get) => ({
  ...EMPTY_PEERS,
  searching: false,
  serverOn: null,

  async discover() {
    if (get().searching) return;
    set({ searching: true });
    let answer: PeerEntry[] | Error;
    try {
      answer = await peerList();
    } catch (e) {
      answer = e instanceof Error ? e : new Error(String(e));
    }
    try {
      set((s) => applyDiscovery(s, answer));
    } finally {
      set({ searching: false });
    }
  },

  async pair(code) {
    try {
      await peerPair(code);
    } catch (e) {
      return String(e);
    }
    await get().discover();
    return null;
  },

  async forget(id) {
    set((s) => withoutPeer(s, id));
    try {
      await peerForget(id);
    } finally {
      await get().discover();
    }
  },

  async loadServer() {
    try {
      set({ serverOn: await getPeerServer() });
    } catch {
      set({ serverOn: false });
    }
  },

  async setServer(on) {
    const was = get().serverOn;
    set({ serverOn: on });
    try {
      await setPeerServer(on);
    } catch (e) {
      set({ serverOn: was });
      throw e;
    }
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
