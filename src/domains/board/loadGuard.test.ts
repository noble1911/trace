// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLoadGuard } from "./loadGuard.ts";

describe("load guard", () => {
  it("lets a load through when no edit landed meanwhile", () => {
    const guard = createLoadGuard();
    const ticket = guard.start();
    assert.equal(guard.isStale(ticket), false);
  });
  it("drops a load that was in flight when an edit landed", () => {
    const guard = createLoadGuard();
    const before = guard.start();
    guard.noteEdit();
    assert.equal(guard.isStale(before), true);
    // A load started after the edit sees it, so it's current.
    const after = guard.start();
    assert.equal(guard.isStale(after), false);
  });
  it("keeps guards apart", () => {
    const a = createLoadGuard();
    const b = createLoadGuard();
    const ticket = b.start();
    a.noteEdit();
    assert.equal(b.isStale(ticket), false);
  });
});
