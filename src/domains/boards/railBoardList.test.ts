// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BoardOption, ProviderKind } from "../issues/types.ts";
import {
  boardInitials,
  boardsByUse,
  boardsNeedingYou,
  lastUsedBoard,
  parseLastOpened,
  pickRailBoards,
} from "./railBoardList.ts";

const board = (provider: ProviderKind, id: string, name = id): BoardOption => ({
  key: `${provider}:${id}`,
  provider,
  boardId: id,
  name,
});
const keys = (boards: BoardOption[]) => boards.map((b) => b.key);

// As the issues store might hold them: custom loaded before Jira.
const BOARDS = [
  board("custom", "1"),
  board("custom", "2"),
  board("jira", "10"),
  board("jira", "11"),
  board("pylon", "open-issues"),
  board("custom", "3"),
  board("jira", "12"),
];

describe("boardsByUse", () => {
  it("lists used boards newest first, then the rest in the trackers' own order", () => {
    const out = boardsByUse(BOARDS, { "custom:2": 100, "jira:11": 300 });
    assert.deepEqual(keys(out), [
      "jira:11",
      "custom:2",
      "jira:10",
      "jira:12",
      "pylon:open-issues",
      "custom:1",
      "custom:3",
    ]);
  });
});

describe("pickRailBoards", () => {
  it("shows at most the limit, and says there are more", () => {
    const { shown, hasMore } = pickRailBoards(BOARDS, {}, null, 6);
    assert.equal(shown.length, 6);
    assert.ok(hasMore);
    assert.equal(pickRailBoards(BOARDS.slice(0, 3), {}, null, 6).hasMore, false);
  });

  it("puts the most recently opened first", () => {
    const { shown } = pickRailBoards(BOARDS, { "custom:3": 5, "pylon:open-issues": 9 }, null, 3);
    assert.deepEqual(keys(shown), ["pylon:open-issues", "custom:3", "jira:10"]);
  });

  it("always includes the board on screen, in the last place when it wouldn't fit", () => {
    const { shown } = pickRailBoards(BOARDS, { "jira:10": 2, "jira:11": 1 }, "custom:3", 3);
    assert.deepEqual(keys(shown), ["jira:10", "jira:11", "custom:3"]);
    const fits = pickRailBoards(BOARDS, { "jira:10": 2 }, "jira:10", 3);
    assert.deepEqual(keys(fits.shown), ["jira:10", "jira:11", "jira:12"]);
  });

  it("is empty with no boards", () => {
    assert.deepEqual(pickRailBoards([], {}, null), { shown: [], hasMore: false });
  });
});

describe("lastUsedBoard", () => {
  it("is the last opened, else the selected, else the first", () => {
    assert.equal(lastUsedBoard(BOARDS, { "custom:2": 1, "jira:12": 4 }, "jira:10")?.key, "jira:12");
    assert.equal(lastUsedBoard(BOARDS, {}, "custom:3")?.key, "custom:3");
    assert.equal(lastUsedBoard(BOARDS, {}, null)?.key, "jira:10");
    assert.equal(lastUsedBoard([], {}, null), null);
  });
});

describe("boardInitials", () => {
  it("takes a one-word name's first two letters", () => {
    assert.equal(boardInitials("Support"), "Su");
    assert.equal(boardInitials("x"), "X");
  });

  it("takes the first letters of the first two words", () => {
    assert.equal(boardInitials("PM Delivery"), "PD");
    assert.equal(boardInitials("side projects for later"), "SP");
    assert.equal(boardInitials("Q3 roadmap"), "QR");
  });

  it("skips anything that isn't a letter or digit", () => {
    assert.equal(boardInitials("  [Ops] — on-call  "), "OO");
    assert.equal(boardInitials("#123"), "12");
    assert.equal(boardInitials("Équipe été"), "ÉÉ");
  });

  it("is empty for a name with no letters", () => {
    assert.equal(boardInitials(""), "");
    assert.equal(boardInitials("  —!? "), "");
  });
});

describe("boardsNeedingYou", () => {
  it("collects the boards of agents waiting on you, where known", () => {
    const lights = {
      "ABC-1": { light: "attention" },
      "ABC-2": { light: "working" },
      "local-4": { light: "attention" },
      "sess-9": { light: "attention" },
    };
    const boardOf = (id: string) =>
      ({ "ABC-1": "jira:10", "ABC-2": "jira:11", "local-4": "custom:1" })[id] ?? null;
    assert.deepEqual([...boardsNeedingYou(lights, boardOf)].sort(), ["custom:1", "jira:10"]);
  });
});

describe("parseLastOpened", () => {
  it("keeps finite numbers only", () => {
    assert.deepEqual(parseLastOpened({ a: 1, b: "2", c: Number.NaN, d: null }), { a: 1 });
    for (const raw of [null, 3, "x", [1, 2]]) assert.deepEqual(parseLastOpened(raw), {});
  });
});
