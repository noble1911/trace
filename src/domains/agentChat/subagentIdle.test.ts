// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDLE_CLOSE_MS, type IdleContext, type IdleThread, idleTabs } from "./subagentIdle.ts";

const NOW = 10 * IDLE_CLOSE_MS;

const thread = (callId: string, more: Partial<IdleThread> = {}): IdleThread => ({
  callId,
  status: "done",
  pending: false,
  startedAt: 0,
  durationMs: 1000,
  ...more,
});

const ctx = (more: Partial<IdleContext> = {}): IdleContext => ({
  now: NOW,
  seen: new Set(),
  closed: [],
  firstSeenFinished: new Map(),
  ...more,
});

describe("idle subagent tabs", () => {
  it("closes a finished, never-shown subagent's tab once it's been idle long enough", () => {
    assert.deepEqual(idleTabs([thread("a")], ctx()), ["a"]);
  });

  it("keeps one that finished recently", () => {
    const recent = thread("a", { startedAt: NOW - 60_000, durationMs: 30_000 });
    assert.deepEqual(idleTabs([recent], ctx()), []);
  });

  it("never closes one that's running or waiting on you", () => {
    const running = thread("a", { status: "running", durationMs: null });
    const asking = thread("b", { pending: true });
    assert.deepEqual(idleTabs([running, asking], ctx()), []);
  });

  it("keeps a tab the user has shown, and skips one already closed", () => {
    const threads = [thread("a"), thread("b"), thread("c")];
    const out = idleTabs(threads, ctx({ seen: new Set(["a"]), closed: ["b"] }));
    assert.deepEqual(out, ["c"]);
  });

  it("times one with no reported duration from when it was first seen finished", () => {
    const t = thread("a", { durationMs: null, status: "stopped" });
    assert.deepEqual(idleTabs([t], ctx()), [], "never seen finished: no clock yet");
    const justNow = ctx({ firstSeenFinished: new Map([["a", NOW - 1000]]) });
    assert.deepEqual(idleTabs([t], justNow), []);
    const longAgo = ctx({ firstSeenFinished: new Map([["a", NOW - IDLE_CLOSE_MS]]) });
    assert.deepEqual(idleTabs([t], longAgo), ["a"]);
  });

  it("closes failed and stopped ones like done ones", () => {
    const out = idleTabs(
      [thread("a", { status: "failed" }), thread("b", { status: "stopped" })],
      ctx()
    );
    assert.deepEqual(out, ["a", "b"]);
  });
});
