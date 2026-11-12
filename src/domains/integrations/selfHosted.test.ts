// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { freeName, SELF_HOSTED, serverUrl } from "./selfHosted.ts";

const metabase = SELF_HOSTED[0];

describe("self-hosted MCP servers", () => {
  it("turns a bare address into the service's MCP URL", () => {
    assert.equal(
      serverUrl("metabase.example.com", metabase),
      "https://metabase.example.com/api/mcp"
    );
    assert.equal(
      serverUrl("  https://bi.example.org/  ", metabase),
      "https://bi.example.org/api/mcp"
    );
  });

  it("keeps a URL that already names its path, and a port", () => {
    assert.equal(
      serverUrl("https://bi.example.org:8443/custom/mcp/", metabase),
      "https://bi.example.org:8443/custom/mcp"
    );
  });

  it("refuses what isn't an https address", () => {
    assert.equal(serverUrl("", metabase), null);
    assert.equal(serverUrl("http://metabase.example.com", metabase), null);
    assert.equal(serverUrl("not an address", metabase), null);
    assert.equal(serverUrl("localhost", metabase), null);
  });

  it("offers the first free name, so a second instance doesn't clash", () => {
    assert.equal(freeName("metabase", []), "metabase");
    assert.equal(freeName("metabase", ["metabase"]), "metabase-2");
    assert.equal(freeName("metabase", ["Metabase", "metabase-2"]), "metabase-3");
  });
});
