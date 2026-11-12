// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cliModel, migrateModel, sdkModelId, usesThinking } from "./model.ts";

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
