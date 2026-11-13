import assert from "node:assert/strict";
import { test } from "node:test";
import { ticketTabsFor } from "./runsOn.ts";

test("a ticket on this machine has every local tab", () => {
  assert.deepEqual(ticketTabsFor(false, false), { files: true, terminal: true, tests: true });
});

test("a ticket in a sandbox has no terminal or tests, and Files only if it can read the checkout", () => {
  assert.deepEqual(ticketTabsFor(true, false), { files: false, terminal: false, tests: false });
  assert.deepEqual(ticketTabsFor(true, true), { files: true, terminal: false, tests: false });
});
