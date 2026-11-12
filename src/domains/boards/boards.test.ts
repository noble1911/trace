// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { navBoardProvider, navTracker, resolveNav } from "../../app/nav.ts";
import type { BoardColumn, Issue, StatusCategory } from "../issues/types.ts";
import { trackerForIssueKey } from "../issues/types.ts";
import { issueBrowseUrl } from "../issues/url.ts";
import {
  draftFields,
  draftFromIssue,
  draftProblem,
  EMPTY_DRAFT,
  parseLabels,
} from "./cardDraft.ts";
import {
  cardCount,
  categoryColor,
  cleanName,
  columnCategory,
  columnId,
  moveTargets,
  stepIndex,
} from "./columns.ts";

const col = (id: string, name: string, category: StatusCategory = "new"): BoardColumn => ({
  name,
  statuses: [{ id, name, category }],
});
const COLUMNS = [
  col("todo", "To do"),
  col("in-progress", "In progress", "indeterminate"),
  col("done", "Done", "done"),
];
const card = (key: string, statusId: string): Issue => ({
  id: key,
  key,
  summary: `Card ${key}`,
  statusId,
  statusName: statusId,
  statusCategory: "new",
  priority: "p1",
  issueType: "Task",
  labels: ["ui", "small fix"],
  description: "Do it",
});

describe("trackerForIssueKey", () => {
  it("knows a custom card by its lowercase local- key", () => {
    assert.equal(trackerForIssueKey("local-12"), "custom");
    assert.equal(trackerForIssueKey("local-1"), "custom");
  });
  it("leaves Jira and Pylon keys where they were", () => {
    assert.equal(trackerForIssueKey("TRACE-12"), "jira");
    assert.equal(trackerForIssueKey("#123"), "pylon");
    assert.equal(trackerForIssueKey("LOCAL-12"), "jira", "upper-case is a Jira project");
    assert.equal(trackerForIssueKey("local-"), "jira");
    assert.equal(trackerForIssueKey("local-1a"), "jira");
  });
});

describe("issueBrowseUrl", () => {
  it("gives a custom card no link, even with a Jira site", () => {
    assert.equal(issueBrowseUrl({ key: "local-3" }, "acme.atlassian.net"), undefined);
  });
  it("still builds Jira's and keeps a provider's own", () => {
    assert.equal(
      issueBrowseUrl({ key: "ABC-1" }, "acme.atlassian.net"),
      "https://acme.atlassian.net/browse/ABC-1"
    );
    assert.equal(issueBrowseUrl({ key: "#4", browseUrl: "https://x/4" }, null), "https://x/4");
  });
});

describe("the Boards page", () => {
  it("shows custom boards and needs no tracker", () => {
    assert.equal(navBoardProvider("boards"), "custom");
    assert.equal(navTracker("boards"), undefined);
    assert.equal(resolveNav("boards", {}), "boards");
  });
  it("keeps the tracker pages' boards", () => {
    assert.equal(navBoardProvider("board"), "jira");
    assert.equal(navBoardProvider("pylon"), "pylon");
    assert.equal(navBoardProvider("fleet"), undefined);
  });
});

describe("custom columns", () => {
  it("read their id and category from their one status", () => {
    assert.equal(columnId(COLUMNS[1]), "in-progress");
    assert.equal(columnCategory(COLUMNS[2]), "done");
    assert.equal(columnId({ name: "Empty", statuses: [] }), null);
    assert.equal(columnCategory({ name: "Empty", statuses: [] }), "new");
  });
  it("colour by category, not place", () => {
    assert.equal(categoryColor("done"), "var(--c-done)");
    assert.equal(categoryColor("indeterminate"), "var(--c-prog)");
    assert.equal(categoryColor("new"), "var(--c-todo)");
  });
  it("count their cards", () => {
    const issues = [card("local-1", "todo"), card("local-2", "todo"), card("local-3", "done")];
    assert.equal(cardCount(issues, "todo"), 2);
    assert.equal(cardCount(issues, "in-progress"), 0);
  });
  it("offer every other column for a deleted one's cards", () => {
    assert.deepEqual(moveTargets(COLUMNS, "in-progress"), [
      { id: "todo", name: "To do" },
      { id: "done", name: "Done" },
    ]);
    assert.deepEqual(moveTargets([COLUMNS[0]], "todo"), []);
  });
  it("step left and right, but not off either end", () => {
    assert.equal(stepIndex(COLUMNS, "in-progress", -1), 0);
    assert.equal(stepIndex(COLUMNS, "in-progress", 1), 2);
    assert.equal(stepIndex(COLUMNS, "todo", -1), null);
    assert.equal(stepIndex(COLUMNS, "done", 1), null);
    assert.equal(stepIndex(COLUMNS, "nope", 1), null);
  });
  it("take a trimmed name, and none from blanks", () => {
    assert.equal(cleanName("  In   review "), "In review");
    assert.equal(cleanName("   "), null);
  });
});

describe("the card form", () => {
  it("needs a summary and nothing else", () => {
    assert.equal(draftProblem(EMPTY_DRAFT), "A card needs a summary.");
    assert.equal(draftProblem({ ...EMPTY_DRAFT, summary: "  " }), "A card needs a summary.");
    assert.equal(draftProblem({ ...EMPTY_DRAFT, summary: "Fix it" }), null);
  });
  it("reads labels from one comma-separated line", () => {
    assert.deepEqual(parseLabels(" ui, small  fix,,ui , "), ["ui", "small fix"]);
    assert.deepEqual(parseLabels(""), []);
  });
  it("round-trips a card", () => {
    const issue = card("local-7", "todo");
    const draft = draftFromIssue(issue);
    assert.equal(draft.labels, "ui, small fix");
    assert.deepEqual(draftFields({ ...draft, summary: ` ${draft.summary} ` }), {
      summary: "Card local-7",
      description: "Do it",
      priority: "p1",
      labels: ["ui", "small fix"],
    });
  });
  it("sends an emptied description, so editing can clear it", () => {
    assert.equal(draftFields({ ...EMPTY_DRAFT, summary: "x", description: "  " }).description, "");
  });
});
