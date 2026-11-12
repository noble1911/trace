// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProviderSession } from "../issues/types.ts";
import {
  BOARD_GROUP,
  groupedRailItems,
  isGroupShown,
  moveRow,
  nudgeRow,
  parseGroupBoards,
  setGroupVisible,
  sidebarRows,
} from "./boardGroup.ts";
import { DEFAULT_SIDEBAR, railItems, type SidebarEntry } from "./items.ts";
import { parseSidebar } from "./prefs.ts";

const ids = (entries: SidebarEntry[]) => entries.map((e) => e.id);
const jira = { jira: {} as ProviderSession };
const hide = (entries: SidebarEntry[], ...hidden: string[]) =>
  entries.map((e) => (hidden.includes(e.id) ? { ...e, visibility: "hidden" as const } : e));

describe("groupedRailItems", () => {
  it("is the separate pages, unchanged, with grouping off", () => {
    assert.deepEqual(
      groupedRailItems(DEFAULT_SIDEBAR, jira, false),
      railItems(DEFAULT_SIDEBAR, jira)
    );
  });

  it("puts one Boards item where the first board page is, and none of the pages", () => {
    const rail = groupedRailItems(DEFAULT_SIDEBAR, jira, true);
    assert.deepEqual(rail.slice(0, 3), ["inbox", BOARD_GROUP, "fleet"]);
    for (const page of ["board", "pylon", "boards"]) assert.ok(!rail.includes(page as never));
    assert.equal(rail.filter((i) => i === BOARD_GROUP).length, 1);
  });

  it("follows the user's order: the first board page, shown or not, places it", () => {
    // Pylon (not connected) first, then Fleet, then Jira's and trace's boards.
    const stored = ["pylon", "fleet", "inbox", "board", "boards", "sessions"];
    const entries = parseSidebar(stored.map((id) => ({ id, visibility: "auto" })));
    assert.deepEqual(groupedRailItems(entries, {}, true).slice(0, 3), [
      BOARD_GROUP,
      "fleet",
      "inbox",
    ]);
  });

  it("is there while any board page is, and only then", () => {
    // trace's own boards need no tracker, so the group shows with nothing connected.
    assert.ok(groupedRailItems(DEFAULT_SIDEBAR, {}, true).includes(BOARD_GROUP));
    const custom = hide(DEFAULT_SIDEBAR, "boards");
    assert.ok(
      !groupedRailItems(custom, {}, true).includes(BOARD_GROUP),
      "no tracker, no boards page"
    );
    assert.ok(groupedRailItems(custom, jira, true).includes(BOARD_GROUP), "Jira's page is on");
    const all = hide(DEFAULT_SIDEBAR, "board", "pylon", "boards");
    assert.ok(!groupedRailItems(all, jira, true).includes(BOARD_GROUP));
    assert.ok(!isGroupShown(all, jira));
  });
});

describe("sidebarRows", () => {
  it("is a row per page with grouping off", () => {
    assert.equal(sidebarRows(DEFAULT_SIDEBAR, false).length, DEFAULT_SIDEBAR.length);
  });

  it("makes the board pages one row, where the first of them is", () => {
    const rows = sidebarRows(DEFAULT_SIDEBAR, true);
    assert.equal(rows.length, DEFAULT_SIDEBAR.length - 2);
    assert.deepEqual(ids(rows[1]), ["board", "pylon", "boards"]);
  });
});

describe("moveRow / nudgeRow", () => {
  it("moves single pages as before with grouping off", () => {
    const out = moveRow(DEFAULT_SIDEBAR, "fleet", "board", false);
    assert.deepEqual(ids(out).slice(0, 3), ["inbox", "fleet", "board"]);
  });

  it("moves the board pages together, gathered side by side", () => {
    const scattered = parseSidebar(
      ["board", "fleet", "pylon", "inbox", "boards"].map((id) => ({ id, visibility: "auto" }))
    );
    const out = moveRow(scattered, "pylon", null, true);
    assert.deepEqual(ids(out).slice(-4), ["board", "pylon", "boards", "settings"]);
    assert.deepEqual([...ids(out)].sort(), [...ids(DEFAULT_SIDEBAR)].sort());
  });

  it("drops a page before the group as a whole", () => {
    const out = moveRow(DEFAULT_SIDEBAR, "activity", "pylon", true);
    assert.deepEqual(ids(out).slice(0, 5), ["inbox", "activity", "board", "pylon", "boards"]);
  });

  it("nudges past the whole group in one step", () => {
    const down = nudgeRow(DEFAULT_SIDEBAR, "inbox", 1, true);
    assert.deepEqual(ids(down).slice(0, 4), ["board", "pylon", "boards", "inbox"]);
    const up = nudgeRow(DEFAULT_SIDEBAR, "boards", -1, true);
    assert.deepEqual(ids(up).slice(0, 4), ["board", "pylon", "boards", "inbox"]);
    assert.equal(nudgeRow(DEFAULT_SIDEBAR, "settings", -1, true), DEFAULT_SIDEBAR);
  });
});

describe("setGroupVisible / parseGroupBoards", () => {
  it("hides every board page, and shows them again keeping a pin", () => {
    const pinned = DEFAULT_SIDEBAR.map((e) =>
      e.id === "pylon" ? { ...e, visibility: "shown" as const } : e
    );
    const hidden = setGroupVisible(pinned, false);
    assert.ok(
      hidden
        .filter((e) => ["board", "pylon", "boards"].includes(e.id))
        .every((e) => e.visibility === "hidden")
    );
    assert.equal(hidden.find((e) => e.id === "fleet")?.visibility, "auto");
    const shown = setGroupVisible(setGroupVisible(pinned, true), true);
    assert.equal(shown.find((e) => e.id === "pylon")?.visibility, "shown");
    assert.equal(setGroupVisible(hidden, true).find((e) => e.id === "boards")?.visibility, "auto");
  });

  it("is on unless stored off", () => {
    assert.equal(parseGroupBoards(null), true);
    assert.equal(parseGroupBoards("on"), true);
    assert.equal(parseGroupBoards("off"), false);
  });
});
