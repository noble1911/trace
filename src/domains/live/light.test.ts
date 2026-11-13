// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lightOf, shownAsk } from "./light.ts";
import type { Ask } from "./types.ts";

const ask: Ask = {
  kind: "permission",
  label: "Permission · Bash",
  tool: "Bash",
  detail: null,
  options: [],
  canAlways: null,
};
const base = { running: true, activity: "waiting" as const, ask: null };

describe("lightOf", () => {
  it("is stopped when not running", () => {
    assert.equal(lightOf({ ...base, running: false }), "stopped");
  });

  it("is attention only for a pending ask, even while activity flickers to working", () => {
    assert.equal(lightOf({ ...base, ask }), "attention");
    assert.equal(lightOf({ ...base, activity: "working", ask }), "attention");
  });

  it("is ready for a finished turn, never attention", () => {
    assert.equal(lightOf(base), "ready");
  });

  it("is working mid-turn, and when it has just started", () => {
    assert.equal(lightOf({ ...base, activity: "working" }), "working");
    assert.equal(lightOf({ ...base, activity: undefined }), "working");
  });
});

describe("shownAsk", () => {
  it("is the ask while the light is attention, nothing otherwise", () => {
    assert.equal(shownAsk({ light: "attention", ask }), ask);
    assert.equal(shownAsk({ light: "ready", ask: null }), null);
    assert.equal(shownAsk(undefined), null);
  });
});
