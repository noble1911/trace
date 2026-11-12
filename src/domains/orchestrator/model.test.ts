// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cliModel,
  migrateModel,
  sdkModelId,
  takesAdaptiveThinking,
  usesThinking,
} from "./model.ts";

const CATALOG = [
  { value: "opus", resolvedModel: "claude-opus-5-5" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5-1" },
  { value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]" },
  { value: "weird", resolvedModel: "weird" },
];

describe("migrateModel", () => {
  it("keeps a saved model", () => assert.equal(migrateModel("haiku", "thorough"), "haiku"));
  it("maps the old speeds", () => {
    assert.equal(migrateModel(null, "thorough"), "opus");
    assert.equal(migrateModel(null, "fast"), "sonnet");
    assert.equal(migrateModel(null, null), "sonnet");
  });
});

describe("sdkModelId", () => {
  it("uses the catalog's resolved id", () => {
    assert.equal(sdkModelId("opus", CATALOG), "claude-opus-5-5");
    assert.equal(sdkModelId("sonnet", CATALOG), "claude-sonnet-5-1");
  });
  it("drops the long-context suffix", () =>
    assert.equal(sdkModelId("opus[1m]", CATALOG), "claude-opus-5-5"));
  it("takes a saved full id as is", () =>
    assert.equal(sdkModelId("claude-haiku-4-5", []), "claude-haiku-4-5"));
  it("falls back to the old ids without a catalog", () => {
    assert.equal(sdkModelId("opus", []), "claude-opus-4-8");
    assert.equal(sdkModelId("sonnet", []), "claude-sonnet-4-6");
    assert.equal(sdkModelId("nonsense", []), "claude-sonnet-4-6");
  });
});

describe("usesThinking and cliModel", () => {
  it("thinks on Opus, not Sonnet", () => {
    assert.equal(usesThinking("opus", CATALOG), true);
    assert.equal(usesThinking("sonnet", CATALOG), false);
    assert.equal(usesThinking("opus", []), true);
  });
  it("passes the value through", () => {
    assert.equal(cliModel("opus[1m]"), "opus[1m]");
    assert.equal(cliModel(""), "sonnet");
  });
});

describe("model ids the API takes", () => {
  it("never sends a cloud provider's id: the family's fallback instead", () => {
    const cloud = [
      { value: "opus", resolvedModel: "claude-opus-4-5@20251101" },
      { value: "sonnet", resolvedModel: "us.anthropic.claude-sonnet-4-6" },
      { value: "big", resolvedModel: "claude-Opus-5-5" },
    ];
    assert.equal(sdkModelId("opus", cloud), "claude-opus-4-8");
    assert.equal(sdkModelId("sonnet", cloud), "claude-sonnet-4-6");
    assert.equal(sdkModelId("big", cloud), "claude-opus-4-8");
    assert.equal(sdkModelId("claude-opus-5-5@x", []), "claude-opus-4-8");
  });
  it("falls back to Fable for Fable, not Sonnet", () => {
    assert.equal(sdkModelId("fable", []), "claude-fable-5-2");
    assert.equal(usesThinking("fable", []), true);
  });
  it("thinks only on ids known to take adaptive thinking", () => {
    for (const id of ["claude-opus-5-5", "claude-opus-4-6", "claude-fable-5", "claude-fable-5-2"]) {
      assert.equal(takesAdaptiveThinking(id), true, id);
    }
    for (const id of [
      "claude-opus-4-5",
      "claude-opus-4-1-20250805",
      "claude-opus-4-20250514",
      "claude-3-opus-20240229",
      "claude-sonnet-5-5",
      "claude-haiku-4-5",
      "claude-mythos-5-2",
      "claude-opus-latest",
      "opus",
    ]) {
      assert.equal(takesAdaptiveThinking(id), false, id);
    }
  });
  it("follows the id actually sent", () => {
    const old = [{ value: "opus", resolvedModel: "claude-opus-4-1" }];
    assert.equal(usesThinking("opus", old), false);
    assert.equal(usesThinking("opus", CATALOG), true);
    assert.equal(usesThinking("weird", CATALOG), false);
  });
});
