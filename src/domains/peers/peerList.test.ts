// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PeerEntry } from "@/ipc/peers";
import {
  agentKindsLine,
  applyDiscovery,
  capabilityWords,
  EMPTY_PEERS,
  readyPeers,
  stateWord,
  withoutPeer,
} from "./peerList.ts";

function peer(over: Partial<PeerEntry>): PeerEntry {
  return {
    id: "p1",
    name: "Mac mini",
    address: "100.64.0.2:47821",
    os: "macOS",
    online: true,
    state: "ready",
    info: {
      hostName: "Mac mini",
      protocol: 1,
      capabilities: {
        turnHooks: true,
        transcript: true,
        files: false,
        terminal: true,
        tests: false,
        agentTools: false,
        chat: false,
      },
      os: "macOS",
      agentKinds: ["claude", "codex"],
      repos: ["acme/widgets"],
    },
    ...over,
  };
}

describe("peer list state", () => {
  it("starts unknown, so the UI can tell 'not looked yet' from 'found nobody'", () => {
    assert.equal(EMPTY_PEERS.peers, null);
    assert.deepEqual(applyDiscovery(EMPTY_PEERS, []), { peers: [], failed: false });
  });

  it("a failed discovery keeps the last list and says it failed", () => {
    const had = applyDiscovery(EMPTY_PEERS, [peer({})]);
    const next = applyDiscovery(had, new Error("boom"));
    assert.equal(next.peers?.length, 1);
    assert.equal(next.failed, true);
    assert.equal(applyDiscovery(next, []).failed, false);
  });

  it("forgetting removes the row by id", () => {
    const state = applyDiscovery(EMPTY_PEERS, [peer({}), peer({ id: "p2", name: "Box" })]);
    assert.deepEqual(
      withoutPeer(state, "p1").peers?.map((p) => p.id),
      ["p2"]
    );
    assert.equal(withoutPeer(EMPTY_PEERS, "p1").peers, null);
  });

  it("only ready peers can be run on", () => {
    const list = [
      peer({}),
      peer({ id: "p2", state: "away" }),
      peer({ id: null, state: "unpaired" }),
    ];
    assert.deepEqual(
      readyPeers(list).map((p) => p.id),
      ["p1"]
    );
    assert.deepEqual(readyPeers(null), []);
  });
});

describe("peer rows", () => {
  it("says why a peer isn't ready", () => {
    assert.equal(stateWord(peer({})), "Ready");
    assert.equal(stateWord(peer({ state: "away", online: false })), "Offline");
    assert.equal(stateWord(peer({ state: "away" })), "Not answering");
    assert.equal(stateWord(peer({ state: "refused" })), "Pair again");
    assert.equal(stateWord(peer({ state: "unpaired" })), "Not paired");
  });

  it("lists what a ready peer offers, and nothing for one that isn't answering", () => {
    assert.deepEqual(capabilityWords(peer({})), ["Terminal", "Transcript"]);
    assert.equal(agentKindsLine(peer({})), "Claude, Codex");
    assert.deepEqual(capabilityWords(peer({ info: null, state: "away" })), []);
    assert.equal(agentKindsLine(peer({ info: null })), "");
  });
});
