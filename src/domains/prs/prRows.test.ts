// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Issue, PullRequest } from "../issues/types.ts";
import { mergePrRows, type PrOwner, type WorkspacePr } from "./prRows.ts";

const issue = (key: string) =>
  ({ key, summary: `${key} summary`, assignee: null }) as unknown as Issue;
const pr = (n: number, state: string, title = ""): PullRequest => ({
  number: String(n),
  url: `https://github.com/o/r/pull/${n}`,
  state,
  title,
});
const session: PrOwner = { kind: "session", id: "s1", title: "Fix login" };
const ws = (n: number, state: string, extra: Partial<WorkspacePr> = {}): WorkspacePr => ({
  url: `https://github.com/o/r/pull/${n}`,
  number: n,
  state,
  owner: session,
  ...extra,
});

describe("mergePrRows", () => {
  it("lists Jira's and the workspaces' PRs together", () => {
    const rows = mergePrRows([[pr(1, "open", "One"), issue("ABC-1")]], [ws(2, "draft")]);
    assert.deepEqual(
      rows.map((r) => [r.number, r.state, r.owner.kind]),
      [
        ["1", "open", "issue"],
        ["2", "draft", "session"],
      ]
    );
  });

  it("lists a PR once, keeping the most final state", () => {
    const rows = mergePrRows(
      [
        [pr(1, "open", "One"), issue("ABC-1")],
        [pr(1, "open", "One"), issue("ABC-2")],
      ],
      [ws(1, "merged", { branch: "workspace/abc-1", author: "ron" })]
    );
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.state, "merged");
    // Jira linked it first: its ticket stays the owner, the watcher's facts fill in.
    assert.deepEqual(row.owner, {
      kind: "issue",
      key: "ABC-1",
      summary: "ABC-1 summary",
      assignee: null,
    });
    assert.equal(row.title, "One");
    assert.equal(row.branch, "workspace/abc-1");
    assert.equal(row.author, "ron");
  });

  it("never lets a stale open shadow a merged one, whichever came first", () => {
    const rows = mergePrRows([], [ws(3, "merged"), ws(3, "open", { title: "Three" })]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "merged");
    assert.equal(rows[0].title, "Three", "a later source fills a missing title");
  });

  it("takes a bare overview reference's number as text", () => {
    const [row] = mergePrRows([], [ws(42, "open")]);
    assert.equal(row.number, "42");
    assert.equal(row.title, "");
    assert.equal(row.branch, null);
  });

  it("drops PRs without a url", () => {
    assert.deepEqual(mergePrRows([[{ ...pr(5, "open"), url: "" }, issue("ABC-5")]], []), []);
  });
});
