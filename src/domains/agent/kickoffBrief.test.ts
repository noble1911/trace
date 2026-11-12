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
  type: "Task",
  board: "Support",
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

describe("kickoff brief: type and board", () => {
  const full = { ...values, type: "Bug", board: "Side projects" };
  it("fills {type} and {board}", () => {
    assert.equal(
      fillKickoffTemplate("Fix {type} {key} on the {board} board", full),
      "Fix Bug #1234 on the Side projects board"
    );
  });
  it("leaves unknown placeholders as typed", () => {
    assert.equal(fillKickoffTemplate("{epic} {type}", full), "{epic} Bug");
  });
});
