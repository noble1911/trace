// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLabels, parsePriority, pickCustomBoard } from "../agentTools/cardArgs.ts";
import type { BoardColumn, BoardData, BoardSummary, Issue } from "../issues/types.ts";
import { formatBoardLines, formatBoardList } from "./boardFormat.ts";
import {
  matchName,
  noColumnMessage,
  normalizeKey,
  parseBoardRef,
  resolveTarget,
} from "./boardRef.ts";
import type { BoardStats } from "./stats.ts";

const col = (
  name: string,
  ...statuses: [string, "new" | "indeterminate" | "done"][]
): BoardColumn => ({
  name,
  statuses: statuses.map(([id, category]) => ({ id, name: id, category })),
});
const COLUMNS = [
  col("To do", ["Open", "new"], ["Reopened", "new"]),
  col("In progress", ["Doing", "indeterminate"]),
  col("Done", ["Closed", "done"]),
];

describe("normalizeKey", () => {
  it("keeps trace cards lowercase, Pylon's # as is, and upper-cases Jira", () => {
    assert.equal(normalizeKey("local-12"), "local-12");
    assert.equal(normalizeKey(" LOCAL-12 "), "local-12");
    assert.equal(normalizeKey("#123"), "#123");
    assert.equal(normalizeKey("trace-12"), "TRACE-12");
    assert.equal(normalizeKey("PM-9"), "PM-9");
  });
});

describe("parseBoardRef", () => {
  it("reads provider:boardId and refuses the rest", () => {
    assert.deepEqual(parseBoardRef("jira:42"), { provider: "jira", boardId: "42" });
    assert.deepEqual(parseBoardRef("pylon:open-issues"), {
      provider: "pylon",
      boardId: "open-issues",
    });
    assert.deepEqual(parseBoardRef("Custom:a:b"), { provider: "custom", boardId: "a:b" });
    assert.equal(parseBoardRef("42"), null);
    assert.equal(parseBoardRef("linear:1"), null);
    assert.equal(parseBoardRef("jira:"), null);
    assert.equal(parseBoardRef(":1"), null);
  });
});

describe("resolving a column or status name", () => {
  it("matches a column exactly, then ignoring case, then a status", () => {
    assert.equal(resolveTarget(COLUMNS, "Done")?.name, "Done");
    assert.equal(resolveTarget(COLUMNS, "in PROGRESS")?.name, "In progress");
    const byStatus = resolveTarget(COLUMNS, "reopened");
    assert.equal(byStatus?.name, "Reopened");
    assert.deepEqual(
      byStatus?.statuses.map((s) => s.id),
      ["Reopened"]
    );
    assert.equal(resolveTarget(COLUMNS, "Blocked"), null);
  });
  it("prefers an exact name over a case-insensitive one", () => {
    const items = [{ n: "done" }, { n: "Done" }];
    assert.equal(matchName(items, "Done", (i) => i.n)?.n, "Done");
  });
  it("lists the columns when nothing matches", () => {
    assert.equal(
      noColumnMessage(COLUMNS, "Blocked"),
      'No column or status named "Blocked". Board columns: To do, In progress, Done.'
    );
  });
});

describe("card arguments", () => {
  const boards: BoardSummary[] = [
    { id: "b1", name: "Ideas", boardType: "custom" },
    { id: "b2", name: "Chores", boardType: "custom" },
  ];
  it("picks a trace board by id or name, or the only one", () => {
    assert.equal(pickCustomBoard(boards, "custom:b2").name, "Chores");
    assert.equal(pickCustomBoard(boards, "ideas").id, "b1");
    assert.equal(pickCustomBoard([boards[0]], "").id, "b1");
  });
  it("explains a missing, unknown or non-trace board", () => {
    assert.throws(() => pickCustomBoard(boards, ""), /Give board.*custom:b1 "Ideas"/);
    assert.throws(() => pickCustomBoard(boards, "Nope"), /No trace board "Nope"/);
    assert.throws(() => pickCustomBoard(boards, "jira:42"), /Jira board/);
  });
  it("reads priority and labels", () => {
    assert.equal(parsePriority("High"), "p1");
    assert.equal(parsePriority("p3"), "p3");
    assert.equal(parsePriority(undefined), undefined);
    assert.throws(() => parsePriority("urgent"), /priority must be/);
    assert.deepEqual(parseLabels("a, b,,c"), ["a", "b", "c"]);
    assert.deepEqual(parseLabels(["x", " y "]), ["x", "y"]);
    assert.equal(parseLabels(undefined), undefined);
    assert.throws(() => parseLabels([1]), /list of strings/);
  });
});

const card = (key: string, statusId: string, statusName: string): Issue => ({
  id: key,
  key,
  summary: `Summary of ${key}`,
  statusId,
  statusName,
  statusCategory: "new",
  priority: "p2",
  issueType: "Task",
  labels: [],
});
const DATA: BoardData = {
  boardId: "b1",
  boardName: "Ideas",
  columns: COLUMNS,
  issues: [card("local-1", "Open", "Open"), card("local-2", "Doing", "Doing")],
};
const STATS: BoardStats = {
  columns: [
    { name: "To do", count: 1 },
    { name: "In progress", count: 1 },
    { name: "Done", count: 0 },
  ],
  total: 2,
  done: 0,
  inProgress: 1,
  todo: 1,
  pctDone: 0,
  unassigned: 2,
  agents: { running: 1, working: 1, needsYou: 0 },
  prs: { open: 0, draft: 0, merged: 0, closed: 0 },
  throughput7d: { merged: 0, raised: 0, started: 0 },
  flags: [],
};

describe("formatBoardLines", () => {
  const lines = formatBoardLines({
    boardKey: "custom:b1",
    provider: "custom",
    data: DATA,
    shown: false,
    issues: DATA.issues,
    scope: "all tickets of the board as fetched.",
    stats: STATS,
    agentOf: (key) => (key === "local-2" ? "working" : "idle"),
    prs: null,
  }).join("\n");

  it("states each column with its statuses and categories", () => {
    assert.match(lines, /- To do \(1\): Open \[new\], Reopened \[new\]/);
    assert.match(lines, /- In progress \(1\): Doing \[indeterminate\]/);
    assert.match(lines, /- Done \(0\): Closed \[done\]/);
  });
  it("says a custom board is a trace board with create_card / update_card", () => {
    assert.match(lines, /TRACE BOARD: kept in trace/);
    assert.match(lines, /create_card/);
    assert.match(lines, /update_card/);
  });
  it("says PRs are unknown rather than counting none, and shows known agent state", () => {
    assert.match(lines, /PRS: unknown/);
    assert.match(lines, /local-2 \[p2\] Task · Doing · unassigned agent=working/);
    assert.doesNotMatch(lines, /local-1 .* agent=/);
    assert.match(lines, /BOARD: custom:b1 "Ideas"\n/);
  });
  it("counts PRs and leaves the trace note off a tracker's shown board", () => {
    const shown = formatBoardLines({
      boardKey: "jira:42",
      provider: "jira",
      data: DATA,
      shown: true,
      issues: DATA.issues,
      scope: "filtered to Ann.",
      stats: STATS,
      agentOf: () => "idle",
      prs: {},
    }).join("\n");
    assert.match(shown, /PRS: 0 open/);
    assert.match(shown, /shown in trace now/);
    assert.doesNotMatch(shown, /TRACE BOARD/);
  });
});

describe("formatBoardList", () => {
  it("lists boards per tracker, marks the shown one and a tracker that failed", () => {
    const text = formatBoardList(
      [
        { provider: "jira", boards: [{ id: "42", name: "PM", boardType: "scrum" }] },
        { provider: "pylon", error: "401" },
        { provider: "custom", boards: [{ id: "b1", name: "Ideas", boardType: "custom" }] },
      ],
      "custom:b1"
    );
    assert.match(text, /- jira:42 "PM" \(scrum\)\n/);
    assert.match(text, /Pylon:\n {2}couldn't list its boards: 401/);
    assert.match(text, /- custom:b1 "Ideas" \(custom\) — shown now/);
    assert.doesNotMatch(text, /No board is shown/);
  });
});
