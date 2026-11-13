// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentLight, Ask, LiveInfo } from "./types.ts";
import { finishedTurns, pruneUnread, withoutUnread, withUnread } from "./unread.ts";

const info = (light: AgentLight, since: number, ask: Ask | null = null): LiveInfo => ({
  light,
  openedAt: 0,
  since,
  ask,
  lastMessage: null,
  update: null,
});

const ask = (kind: Ask["kind"]): Ask => ({
  kind,
  label: kind,
  tool: null,
  detail: null,
  options: [],
  canAlways: null,
});

const unseen = () => true;
const seen = () => false;

describe("finishedTurns", () => {
  it("counts working → ready with the turn unseen as a finished turn", () => {
    assert.deepEqual(finishedTurns({ a: info("working", 10) }, { a: info("ready", 20) }, unseen), [
      "a",
    ]);
  });

  it("ignores a seen agent settling to ready (an idle repaint)", () => {
    assert.deepEqual(finishedTurns({ a: info("working", 10) }, { a: info("ready", 20) }, seen), []);
  });

  it("counts the 'needs input' nudge, not a permission or a question", () => {
    const prev = { a: info("working", 10), b: info("working", 10), c: info("working", 10) };
    const next = {
      a: info("attention", 20, ask("input")),
      b: info("attention", 20, ask("permission")),
      c: info("attention", 20, ask("question")),
    };
    assert.deepEqual(finishedTurns(prev, next, seen), ["a"]);
  });

  it("ignores agents that were not working", () => {
    const prev = { a: info("ready", 10), b: info("attention", 10) };
    const next = { a: info("ready", 20), b: info("attention", 20) };
    assert.deepEqual(finishedTurns(prev, next, unseen), []);
  });

  it("ignores a repaint flicker, which hands the light back its older since", () => {
    assert.deepEqual(
      finishedTurns({ a: info("working", 50) }, { a: info("ready", 20) }, unseen),
      []
    );
  });

  it("ignores an agent that just appeared (a reload re-adopting it)", () => {
    assert.deepEqual(finishedTurns({}, { a: info("ready", 20) }, unseen), []);
  });
});

describe("the unread list", () => {
  it("adds new ids once, in order, and keeps the same array when nothing is new", () => {
    const start = ["s1"];
    assert.deepEqual(withUnread(start, ["s2", "s1", "s2"]), ["s1", "s2"]);
    assert.equal(withUnread(start, ["s1"]), start);
    assert.equal(withUnread(start, []), start);
  });

  it("clears one id, and keeps the same array when it wasn't there", () => {
    const start = ["s1", "s2"];
    assert.deepEqual(withoutUnread(start, "s1"), ["s2"]);
    assert.equal(withoutUnread(start, "s3"), start);
  });

  it("drops deleted sessions, but nothing before the list has loaded", () => {
    const start = ["s1", "s2"];
    assert.deepEqual(pruneUnread(start, ["s2", "s3"]), ["s2"]);
    assert.equal(pruneUnread(start, ["s1", "s2"]), start);
    assert.equal(pruneUnread(start, []), start);
  });
});
