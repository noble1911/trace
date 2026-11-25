// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { creatorKey, creatorKind, creatorLabel, sessionsStartedBy } from "./createdBy.ts";
import {
  asSortMode,
  cleanOrder,
  heldOrder,
  insertBefore,
  manualOrder,
  moveBy,
  type SortContext,
  sortSessions,
} from "./sortSessions.ts";
import type { CreatedBy, ScratchSession } from "./types.ts";

const s = (id: string, createdAt: number, over: Partial<ScratchSession> = {}): ScratchSession => ({
  id,
  title: id.toUpperCase(),
  cli: "claude",
  createdAt,
  ...over,
});

const byAgent = (parent: string): CreatedBy => ({
  kind: "agent",
  workspaceId: parent,
  parent: "session",
  label: `Parent ${parent}`,
});

const ctx = (over: Partial<SortContext> = {}): SortContext => ({
  lights: {},
  lastActive: {},
  order: [],
  ...over,
});

const ids = (rows: { session: ScratchSession }[]) => rows.map((r) => r.session.id);

describe("manual order", () => {
  it("puts sessions the saved order doesn't know on top, newest first", () => {
    const items = [s("a", 1), s("b", 2), s("new1", 10), s("new2", 20)];
    assert.deepEqual(
      manualOrder(items, ["b", "a"]).map((x) => x.id),
      ["new2", "new1", "b", "a"]
    );
  });

  it("ignores ids that aren't in the list and repeats", () => {
    const items = [s("a", 1), s("b", 2)];
    assert.deepEqual(
      manualOrder(items, ["gone", "a", "a", "b"]).map((x) => x.id),
      ["a", "b"]
    );
  });

  it("cleanOrder drops non-strings, unknown ids and repeats from stored data", () => {
    assert.deepEqual(cleanOrder(["a", 3, null, "x", "a", "b"], new Set(["a", "b"])), ["a", "b"]);
    assert.deepEqual(cleanOrder("a,b", new Set(["a"])), []);
  });

  it("moveBy swaps with a neighbour and stops at the ends", () => {
    assert.deepEqual(moveBy(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moveBy(["a", "b", "c"], "c", 1), ["a", "b", "c"]);
    assert.deepEqual(moveBy(["a", "b"], "zz", 1), ["a", "b"]);
  });

  it("insertBefore places once, and at the end for null or an unknown target", () => {
    assert.deepEqual(insertBefore(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
    assert.deepEqual(insertBefore(["a", "b", "c"], "a", null), ["b", "c", "a"]);
    assert.deepEqual(insertBefore(["a", "b"], "n", "gone"), ["a", "b", "n"]);
  });

  it("an unknown stored sort reads as manual", () => {
    assert.equal(asSortMode("status"), "status");
    assert.equal(asSortMode("vibes"), "manual");
    assert.equal(asSortMode(undefined), "manual");
  });
});

describe("sorts", () => {
  const items = [s("b", 2), s("a", 1), s("c", 3)];

  it("by status: needs you, working, ready, stopped; ties keep manual order", () => {
    const lights = { a: "ready", b: "attention", c: "ready" } as const;
    const rows = sortSessions(items, "status", ctx({ lights, order: ["c", "a", "b"] }));
    assert.deepEqual(ids(rows), ["b", "c", "a"]);
  });

  it("by name, newest, oldest and last active", () => {
    assert.deepEqual(ids(sortSessions(items, "name", ctx())), ["a", "b", "c"]);
    assert.deepEqual(ids(sortSessions(items, "newest", ctx())), ["c", "b", "a"]);
    assert.deepEqual(ids(sortSessions(items, "oldest", ctx())), ["a", "b", "c"]);
    const lastActive = { a: 9_000, b: 1_000 };
    // c has no activity: its creation (3s) counts.
    assert.deepEqual(ids(sortSessions(items, "active", ctx({ lastActive }))), ["a", "c", "b"]);
  });

  it("name sorts numbers naturally and ignores case", () => {
    const named = [s("x", 1, { title: "spike 10" }), s("y", 2, { title: "Spike 2" })];
    assert.deepEqual(ids(sortSessions(named, "name", ctx())), ["y", "x"]);
  });

  it("started by: yours first, children indented under a parent in the list", () => {
    const list = [
      s("p", 5),
      s("child", 4, { createdBy: byAgent("p") }),
      s("grand", 3, { createdBy: byAgent("child") }),
      s("orphan", 6, { createdBy: byAgent("deleted") }),
      s("sched", 7, { createdBy: { kind: "schedule", promptId: "n", label: "Nightly" } }),
      s("mine", 1),
    ];
    const rows = sortSessions(list, "creator", ctx({ order: ["p", "mine"] }));
    assert.deepEqual(
      rows.map((r) => `${r.session.id}:${r.depth}`),
      // Order mentions p and mine; the others are new, so their base is newest first.
      ["p:0", "child:1", "grand:2", "mine:0", "sched:0", "orphan:0"]
    );
  });

  it("started by survives a parent loop", () => {
    const loop = [s("a", 1, { createdBy: byAgent("b") }), s("b", 2, { createdBy: byAgent("a") })];
    assert.deepEqual(ids(sortSessions(loop, "creator", ctx())).sort(), ["a", "b"]);
  });
});

describe("holding the order", () => {
  it("keeps shown rows in place, drops gone ones, puts new ones on top", () => {
    assert.deepEqual(heldOrder(["a", "b", "c"], ["c", "b", "d"]), ["d", "b", "c"]);
  });
});

describe("created by", () => {
  it("reads old sessions as the user and keeps the parent's label", () => {
    assert.equal(creatorLabel(s("a", 1).createdBy ?? { kind: "user" }), "you");
    assert.equal(creatorLabel(byAgent("p")), "Parent p");
  });

  it("lists the active sessions an agent started", () => {
    const list = [
      s("c1", 1, { createdBy: byAgent("p") }),
      s("c2", 2, { createdBy: byAgent("p"), archivedAt: 5 }),
      s("c3", 3, { createdBy: byAgent("q") }),
    ];
    assert.deepEqual(
      sessionsStartedBy(list, "p").map((x) => x.id),
      ["c1"]
    );
  });

  it("names a session another computer started by that computer", () => {
    const peer: CreatedBy = { kind: "peer", label: "studio-mac" };
    assert.equal(creatorLabel(peer), "studio-mac");
    assert.equal(creatorKind(peer), "Another computer");
    assert.equal(creatorKey(peer), "peer:studio-mac");
    // Not an agent's child: it never nests under a session.
    assert.deepEqual(sessionsStartedBy([s("x", 1, { createdBy: peer })], "studio-mac"), []);
  });
});
