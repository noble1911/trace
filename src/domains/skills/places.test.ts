// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Installed, Installs } from "../../ipc/skills.ts";
import { isNewer, placesFor, placesSummary } from "./places.ts";

const at = (id: string, scope: Installed["scope"], version = "0.1.0"): Installed => ({
  id,
  version,
  scope,
  enabled: true,
  projectPath: null,
});

const installs: Installs = {
  user: [at("delivery@obsidian", "user", "0.9.2")],
  projects: [
    { repo: "/r/terminal", installed: [], committed: ["delivery@obsidian", "cass@obsidian"] },
    { repo: "/r/web", installed: [at("support@obsidian", "local")], committed: [] },
  ],
};

test("lists you first, then each repository with what's there", () => {
  const places = placesFor("support@obsidian", installs);
  assert.deepEqual(
    places.map((p) => (p.kind === "you" ? "you" : p.repo)),
    ["you", "/r/terminal", "/r/web"]
  );
  assert.equal(places[0]?.installed, null);
  const web = places[2];
  assert.ok(web?.kind === "repo" && web.installed?.scope === "local");
});

test("a plugin the default branch enables comes with the repository", () => {
  const terminal = placesFor("cass@obsidian", installs)[1];
  assert.ok(terminal?.kind === "repo" && terminal.committed && !terminal.installed);
});

test("the card says where it's installed, you first", () => {
  assert.equal(placesSummary(placesFor("delivery@obsidian", installs)), "Installed for you");
  assert.equal(placesSummary(placesFor("support@obsidian", installs)), "Installed in 1 repository");
  assert.equal(placesSummary(placesFor("company@obsidian", installs)), null);
});

test("versions compare as numbers, not text", () => {
  assert.equal(isNewer("0.10.0", "0.9.2"), true);
  assert.equal(isNewer("0.9.2", "0.9.2"), false);
  assert.equal(isNewer("0.9.1", "0.9.2"), false);
  assert.equal(isNewer("1.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "1.0"), false);
  assert.equal(isNewer(null, "1.0.0"), false);
});
