import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Release } from "../../ipc/update.ts";
import {
  compareVersions,
  formatReleaseDate,
  initialCount,
  OLDER_SHOWN,
  releaseMark,
  sortReleases,
} from "./releaseNotes.ts";

const rel = (version: string): Release => ({ version, notes: "", publishedAt: null, url: null });

describe("release notes", () => {
  it("compares versions by number, not text", () => {
    assert.ok(compareVersions("0.16.10", "0.16.9") > 0);
    assert.ok(compareVersions("0.9.0", "0.16.0") < 0);
    assert.equal(compareVersions("v0.16.1", "0.16.1"), 0);
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
    assert.equal(compareVersions("0.17.0-rc.1", "0.17.0"), 0);
  });

  it("marks newer releases and the installed one", () => {
    assert.equal(releaseMark("0.16.1", "0.15.0"), "new");
    assert.equal(releaseMark("0.15.0", "0.15.0"), "installed");
    assert.equal(releaseMark("0.14.1", "0.15.0"), null);
    assert.equal(releaseMark("0.16.1", ""), null);
  });

  it("sorts newest first", () => {
    const sorted = sortReleases([rel("0.9.0"), rel("0.16.1"), rel("0.16.0")]);
    assert.deepEqual(
      sorted.map((r) => r.version),
      ["0.16.1", "0.16.0", "0.9.0"]
    );
  });

  it("shows every newer release, yours and a few before it", () => {
    const sorted = sortReleases(
      ["0.16.1", "0.16.0", "0.15.0", "0.14.1", "0.14.0", "0.13.0", "0.12.0", "0.11.0"].map(rel)
    );
    // 0.16.1, 0.16.0 newer; 0.15.0 yours; then OLDER_SHOWN older ones.
    assert.equal(initialCount(sorted, "0.15.0"), 2 + 1 + OLDER_SHOWN);
    assert.equal(initialCount(sorted, "0.17.0"), OLDER_SHOWN);
    assert.equal(initialCount(sorted, "0.11.0"), sorted.length);
    assert.equal(initialCount(sorted, ""), sorted.length);
  });

  it("formats a release date, or nothing", () => {
    assert.match(formatReleaseDate("2026-11-17T15:22:14Z"), /2026/);
    assert.equal(formatReleaseDate(null), "");
    assert.equal(formatReleaseDate("not a date"), "");
  });
});
