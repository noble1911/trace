// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NavId } from "../../app/nav.ts";
import type { ProviderSession } from "../issues/types.ts";
import { DEFAULT_SIDEBAR, pinnedPages, railItems, type SidebarEntry } from "./items.ts";
import { isDefaultSidebar, moveEntry, nudgeEntry, parseSidebar } from "./prefs.ts";

const ids = (entries: SidebarEntry[]) => entries.map((e) => e.id);
const DEFAULT_IDS = ids(DEFAULT_SIDEBAR);
const jira = { jira: {} as ProviderSession };

describe("parseSidebar", () => {
  it("gives the built-in list for nothing or junk stored", () => {
    for (const raw of [undefined, null, "rail", 3, {}, { inbox: "hidden" }]) {
      assert.deepEqual(parseSidebar(raw), DEFAULT_SIDEBAR);
    }
  });

  it("keeps a valid stored order and visibility", () => {
    const stored = [...DEFAULT_SIDEBAR].reverse().map((e) => ({ ...e }));
    stored[1].visibility = "hidden";
    const out = parseSidebar(stored);
    // Settings stays last whatever was stored.
    assert.equal(out.at(-1)?.id, "settings");
    assert.deepEqual(ids(out.slice(0, -1)), DEFAULT_IDS.slice(0, -1).reverse());
    assert.equal(out.find((e) => e.id === stored[1].id)?.visibility, "hidden");
  });

  it("drops unknown ids, repeats and malformed rows", () => {
    const out = parseSidebar([
      { id: "activity", visibility: "hidden" },
      { id: "nope", visibility: "shown" },
      { id: "activity", visibility: "shown" },
      "inbox",
      null,
      { visibility: "hidden" },
      { id: 4 },
    ]);
    assert.equal(out.filter((e) => e.id === "activity").length, 1);
    assert.equal(out.find((e) => e.id === "activity")?.visibility, "hidden", "the first copy wins");
    assert.ok(!ids(out).includes("nope" as NavId));
    assert.deepEqual([...ids(out)].sort(), [...DEFAULT_IDS].sort());
  });

  it("turns a bad visibility into auto", () => {
    const out = parseSidebar([{ id: "fleet", visibility: "sometimes" }, { id: "inbox" }]);
    assert.equal(out.find((e) => e.id === "fleet")?.visibility, "auto");
    assert.equal(out.find((e) => e.id === "inbox")?.visibility, "auto");
  });

  it("puts items the stored list lacks back after the item they follow by default", () => {
    // Saved before Pylon and Fleet existed, in a custom order.
    const stored = ["sessions", "inbox", "board", "scheduled", "pr", "activity", "integrations"];
    const out = parseSidebar(stored.map((id) => ({ id, visibility: "auto" })));
    assert.deepEqual(ids(out), [
      "sessions",
      "inbox",
      "board",
      "pylon",
      "boards",
      "fleet",
      "scheduled",
      "pr",
      "activity",
      "integrations",
      "settings",
    ]);
  });

  it("puts a new first item first", () => {
    const out = parseSidebar([{ id: "activity", visibility: "hidden" }]);
    assert.equal(out[0].id, "inbox");
    assert.deepEqual(ids(out).slice(0, -1).sort(), DEFAULT_IDS.slice(0, -1).sort());
  });

  it("never hides or moves Settings", () => {
    const out = parseSidebar([
      { id: "settings", visibility: "hidden" },
      { id: "inbox", visibility: "auto" },
    ]);
    assert.deepEqual(out.at(-1), { id: "settings", visibility: "auto" });
    assert.equal(out.filter((e) => e.id === "settings").length, 1);
  });
});

describe("moveEntry / nudgeEntry", () => {
  it("moves an item before another, or to the end of the movable ones", () => {
    const a = moveEntry(DEFAULT_SIDEBAR, "activity", "inbox");
    assert.deepEqual(ids(a).slice(0, 2), ["activity", "inbox"]);
    const b = moveEntry(DEFAULT_SIDEBAR, "inbox", null);
    assert.deepEqual(ids(b).slice(-2), ["inbox", "settings"]);
    const c = moveEntry(DEFAULT_SIDEBAR, "inbox", "settings");
    assert.deepEqual(ids(c).slice(-2), ["inbox", "settings"]);
  });

  it("leaves fixed items and unknown ids alone", () => {
    assert.equal(moveEntry(DEFAULT_SIDEBAR, "settings", "inbox"), DEFAULT_SIDEBAR);
    assert.equal(moveEntry(DEFAULT_SIDEBAR, "inbox", "inbox"), DEFAULT_SIDEBAR);
    assert.equal(nudgeEntry(DEFAULT_SIDEBAR, "settings", -1), DEFAULT_SIDEBAR);
  });

  it("nudges one place, not past either end or a fixed item", () => {
    assert.deepEqual(ids(nudgeEntry(DEFAULT_SIDEBAR, "board", -1)).slice(0, 2), ["board", "inbox"]);
    assert.equal(nudgeEntry(DEFAULT_SIDEBAR, "inbox", -1), DEFAULT_SIDEBAR);
    assert.equal(nudgeEntry(DEFAULT_SIDEBAR, "integrations", 1), DEFAULT_SIDEBAR);
  });

  it("knows the built-in list", () => {
    assert.ok(isDefaultSidebar(DEFAULT_SIDEBAR));
    assert.ok(!isDefaultSidebar(nudgeEntry(DEFAULT_SIDEBAR, "board", -1)));
  });
});

describe("railItems", () => {
  it("shows tracker pages only while their tracker is connected, by default", () => {
    assert.ok(!railItems(DEFAULT_SIDEBAR, {}).includes("pr"));
    assert.ok(!railItems(DEFAULT_SIDEBAR, {}).includes("board"));
    assert.ok(railItems(DEFAULT_SIDEBAR, {}).includes("activity"));
    assert.ok(railItems(DEFAULT_SIDEBAR, jira).includes("pr"));
    assert.ok(!railItems(DEFAULT_SIDEBAR, {}).includes("settings"), "Settings is drawn apart");
  });

  it("follows the user's order and overrides", () => {
    let entries = moveEntry(DEFAULT_SIDEBAR, "activity", "inbox");
    entries = entries.map((e) =>
      e.id === "pr"
        ? { ...e, visibility: "shown" }
        : e.id === "fleet"
          ? { ...e, visibility: "hidden" }
          : e
    );
    const rail = railItems(entries, {});
    assert.equal(rail[0], "activity");
    assert.ok(rail.includes("pr"));
    assert.ok(!rail.includes("fleet"));
    assert.deepEqual(pinnedPages(entries), ["pr"]);
  });
});
