// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveAssignee } from "../board/assignee.ts";
import { agentsOnBoard } from "./boardAgents.ts";
import { normalizeKey } from "./boardRef.ts";

describe("normalizeKey with a Jira project keyed LOCAL", () => {
  const seen = new Set(["LOCAL-12"]);
  const isTrackerKey = (key: string) => seen.has(key);
  it("keeps a LOCAL ticket trace has seen on a tracker", () => {
    assert.equal(normalizeKey("LOCAL-12", isTrackerKey), "LOCAL-12");
    assert.equal(normalizeKey(" Local-12 ", isTrackerKey), "LOCAL-12");
  });
  it("reads an exact local-12 as the trace card, even then", () =>
    assert.equal(normalizeKey("local-12", isTrackerKey), "local-12"));
  it("reads one it hasn't seen as a trace card", () => {
    assert.equal(normalizeKey("LOCAL-13", isTrackerKey), "local-13");
    assert.equal(normalizeKey("LOCAL-12"), "local-12");
  });
  it("leaves other keys as before", () => {
    assert.equal(normalizeKey("localx-1", isTrackerKey), "LOCALX-1");
    assert.equal(normalizeKey("#7", isTrackerKey), "#7");
  });
});

describe("effectiveAssignee", () => {
  it("shows everyone on a trace board, whatever was saved", () => {
    assert.equal(effectiveAssignee("custom", "acc-1", "me"), null);
    assert.equal(effectiveAssignee("custom", undefined, "me"), null);
  });
  it("defaults a tracker's board to the user until they pick", () => {
    assert.equal(effectiveAssignee("jira", undefined, "me"), "me");
    assert.equal(effectiveAssignee("pylon", undefined, null), null);
  });
  it("keeps a pick: everyone or one person", () => {
    assert.equal(effectiveAssignee("jira", null, "me"), null);
    assert.equal(effectiveAssignee("jira", "acc-1", "me"), "acc-1");
  });
});

describe("agentsOnBoard", () => {
  it("keeps only the agents of the board's tickets", () => {
    const running = new Set(["PM-1", "PM-9", "session-abc", "term:PM-1", "local-3"]);
    const issues = [{ key: "PM-1" }, { key: "PM-2" }, { key: "local-3" }];
    assert.deepEqual([...agentsOnBoard(running, issues)].sort(), ["PM-1", "local-3"]);
  });
  it("is empty for a board with none running", () =>
    assert.equal(agentsOnBoard(new Set(["X-1"]), [{ key: "Y-1" }]).size, 0));
});
