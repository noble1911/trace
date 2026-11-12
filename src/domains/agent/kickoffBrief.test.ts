// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillKickoffTemplate } from "./kickoffBrief.ts";

const values = {
  tracker: "Pylon",
  key: "#1234",
  summary: "Export fails",
  description: "It says {key} literally and costs $1",
  comments: "(no comments yet)",
};

describe("kickoff brief", () => {
  it("names the ticket's tracker", () => {
    assert.equal(
      fillKickoffTemplate("Work on {tracker} ticket {key}: {summary}", values),
      "Work on Pylon ticket #1234: Export fails"
    );
  });

  it("leaves placeholders inside ticket text, and $ patterns, alone", () => {
    assert.equal(
      fillKickoffTemplate("{description}", values),
      "It says {key} literally and costs $1"
    );
  });
});
