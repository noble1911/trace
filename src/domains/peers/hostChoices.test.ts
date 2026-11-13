import assert from "node:assert/strict";
import { test } from "node:test";
import type { PeerEntry } from "../../ipc/peers.ts";
import { peerChoices, peerHostId, peerIdOf, peerName } from "./hostChoices.ts";

function peer(over: Partial<PeerEntry>): PeerEntry {
  return {
    id: "p1",
    name: "studio",
    address: "100.64.0.2",
    os: null,
    online: true,
    state: "ready",
    info: null,
    ...over,
  };
}

test("host ids round-trip and only peers parse", () => {
  assert.equal(peerHostId("p1"), "peer:p1");
  assert.equal(peerIdOf("peer:p1"), "p1");
  assert.equal(peerIdOf("vercel"), null);
  assert.equal(peerIdOf("local"), null);
  assert.equal(peerIdOf("peer:"), null);
});

test("a ready peer can be picked", () => {
  const [c] = peerChoices([peer({})]);
  assert.equal(c?.host, "peer:p1");
  assert.equal(c?.reason, undefined);
});

test("an unreachable peer can't be picked and says why", () => {
  const [off, srv, refused] = peerChoices([
    peer({ id: "a", state: "away", online: false }),
    peer({ id: "b", state: "away", online: true }),
    peer({ id: "c", state: "refused" }),
  ]);
  assert.equal(off?.reason, "Offline");
  assert.equal(srv?.reason, "Its trace server is off");
  assert.match(refused?.reason ?? "", /Pair again/);
});

test("an unpaired device isn't a host", () => {
  assert.deepEqual(peerChoices([peer({ id: null, state: "unpaired" })]), []);
  assert.deepEqual(peerChoices(null), []);
});

test("a badge names the peer, with a fallback when it isn't listed", () => {
  assert.equal(peerName([peer({})], "p1"), "studio");
  assert.equal(peerName(null, "abcdefgh"), "peer abcdef");
});
