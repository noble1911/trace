// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextPrLinks } from "./prLinks.ts";

const A = "https://github.com/acme/web/pull/1";
const B = "https://github.com/acme/web/pull/2";

test("a look that failed part-way keeps the PRs already known", () => {
  assert.deepEqual(nextPrLinks([A, B], { urls: [], complete: false }), [A, B]);
});

test("a partial look adds what it found, first", () => {
  const C = "https://github.com/acme/web/pull/3";
  assert.deepEqual(nextPrLinks([A, B], { urls: [C, B], complete: false }), [C, B, A]);
});

test("a complete look is the answer", () => {
  assert.deepEqual(nextPrLinks([A, B], { urls: [B], complete: true }), [B]);
  assert.deepEqual(nextPrLinks([A], { urls: [], complete: true }), []);
});

test("the first look is taken as it is", () => {
  assert.deepEqual(nextPrLinks(undefined, { urls: [A], complete: false }), [A]);
});
