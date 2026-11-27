// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../activity/types.ts";
import type { ScratchSession } from "../sessions/types.ts";
import { activityLine, filterActivity, parseSince } from "./activityFilter.ts";
import { flag, int, need, str } from "./args.ts";
import { capDiffs, changeList, unified } from "./changesFormat.ts";
import { callerRef, notYours, startedByCaller } from "./ownership.ts";
import { isFullName, pickRepo, repoChoices } from "./repoRules.ts";

const session = (id: string, over: Partial<ScratchSession> = {}): ScratchSession => ({
  id,
  title: `Session ${id}`,
  cli: "claude",
  createdAt: 1_700_000_000,
  ...over,
});

const bySession = (parent: string) => ({
  createdBy: {
    kind: "agent" as const,
    workspaceId: parent,
    parent: "session" as const,
    label: parent,
  },
});

describe("argument checks", () => {
  it("reads strings, flags and bounded numbers, and refuses the rest", () => {
    assert.equal(str({ a: "  x " }, "a"), "x");
    assert.equal(str({ a: 3 }, "a"), "");
    assert.equal(str(null, "a"), "");
    assert.throws(() => need({}, "session_id"), /Give session_id/);
    assert.equal(flag({ d: true }, "d"), true);
    assert.equal(flag({ d: "true" }, "d"), false);
    assert.equal(int({}, "limit", 50, 1, 200), 50);
    assert.equal(int({ limit: 7 }, "limit", 50, 1, 200), 7);
    for (const bad of [0, 201, 2.5, "9"]) {
      assert.throws(() => int({ limit: bad }, "limit", 50, 1, 200), /whole number/);
    }
  });

  it("only takes owner/name for a clone", () => {
    for (const ok of ["noble1911/trace", "o/a.b_c-d"]) assert.ok(isFullName(ok), ok);
    for (const bad of ["trace", "a/b/c", "-o/x", "o/..", "o/.", "o/a b", "../x", "o/--depth=1"]) {
      assert.ok(!isFullName(bad), bad);
    }
  });
});

describe("stop and interrupt ownership", () => {
  const parent = session("parent");
  const child = session("child", bySession("parent"));
  const grandchild = session("grand", bySession("child"));
  const users = session("users");
  const others = session("others", bySession("someone-else"));
  const orch = session("orch", { createdBy: { kind: "orchestrator" } });
  const withCompanion = session("p2", { agents: [{ id: "p2-codex", cli: "codex" } as never] });
  const companionChild = session("cc", bySession("p2"));
  const all = [parent, child, grandchild, users, others, orch, withCompanion, companionChild];

  it("allows a session the caller started, and their descendants", () => {
    assert.ok(startedByCaller(child, "parent", all));
    assert.ok(startedByCaller(grandchild, "parent", all));
    assert.ok(startedByCaller(grandchild, "child", all));
  });

  it("refuses the user's, the orchestrator's, another agent's, its parent's and itself", () => {
    for (const target of [users, others, orch, parent]) {
      assert.ok(!startedByCaller(target, "parent", all), target.id);
    }
    assert.ok(!startedByCaller(parent, "child", all), "a child can't stop its parent");
    assert.ok(!startedByCaller(child, "child", all), "not itself");
    assert.ok(!startedByCaller(child, "", all), "no caller");
  });

  it("a companion agent speaks for its session", () => {
    assert.deepEqual(callerRef("p2-codex", all), { kind: "session", id: "p2" });
    assert.ok(startedByCaller(companionChild, "p2-codex", all));
  });

  it("matches tickets and scheduled runs by their own records", () => {
    const ticketChild = session("t", {
      createdBy: { kind: "agent", workspaceId: "ENG-1", parent: "ticket", label: "ENG-1" },
    });
    const runChild = session("r", {
      createdBy: { kind: "schedule", promptId: "p", runId: "run-9", label: "Nightly" },
    });
    const list = [...all, ticketChild, runChild];
    assert.ok(startedByCaller(ticketChild, "ENG-1", list));
    assert.ok(!startedByCaller(ticketChild, "ENG-2", list));
    assert.ok(startedByCaller(runChild, "sched:run-9", list));
    assert.ok(!startedByCaller(runChild, "sched:run-8", list));
    // A ticket named like a session id doesn't pass as that session.
    assert.ok(!startedByCaller(session("x", bySession("ENG-1")), "ENG-1", list));
  });

  it("a creator loop ends in a refusal", () => {
    const a = session("a", bySession("b"));
    const b = session("b", bySession("a"));
    assert.ok(!startedByCaller(a, "zzz", [a, b]));
  });

  it("the refusal says the user can do it", () => {
    assert.match(notYours("Spike", "stop"), /user can stop it from trace/);
  });
});

describe("session changes", () => {
  const summary = {
    base: "origin/main",
    files: [
      { path: "src/a.ts", add: 3, del: 1, status: "modified" as const },
      { path: "src/new.ts", add: 10, del: 0, status: "untracked" as const },
      { path: "src/b.ts", add: 0, del: 0, status: "renamed" as const, oldPath: "src/old.ts" },
    ],
    ownWorktree: true,
  };

  it("lists files with status and counts", () => {
    const text = changeList(summary);
    assert.match(text, /^3 files changed against origin\/main, \+13 −1:/);
    assert.match(text, /\nM src\/a\.ts \+3 −1/);
    assert.match(text, /\n\? src\/new\.ts \+10 −0/);
    assert.match(text, /R src\/b\.ts \(from src\/old\.ts\)/);
    assert.equal(
      changeList({ base: "origin/main", files: [], ownWorktree: true }),
      "No changes against origin/main."
    );
  });

  it("rebuilds a unified diff", () => {
    const diff = {
      path: "src/a.ts",
      add: 1,
      del: 1,
      hunks: [
        {
          header: "@@ -1,2 +1,2 @@",
          lines: [
            { kind: "ctx" as const, oldNo: 1, newNo: 1, text: "keep" },
            { kind: "del" as const, oldNo: 2, newNo: null, text: "old" },
            { kind: "add" as const, oldNo: null, newNo: 2, text: "new" },
          ],
        },
      ],
    };
    assert.equal(
      unified(diff, summary.files[0]),
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n keep\n-old\n+new"
    );
    assert.match(unified({ ...diff, hunks: [] }, summary.files[1]), /--- \/dev\/null/);
  });

  it("caps diffs at a line end and says what was left out", () => {
    const line = "x".repeat(99);
    const big = Array.from({ length: 50 }, () => line).join("\n");
    const out = capDiffs([big, "second file"], 1_000);
    const [kept, note] = out.split("\n\n[Truncated");
    assert.ok(kept.length <= 1_000);
    assert.ok(kept.endsWith(line), "cut at a line end");
    assert.match(note, /^ at 1,000 characters: about [\d,]+ more, in 2 files/);
    assert.equal(capDiffs(["a", "b"], 1_000), "a\n\nb");
    assert.ok(capDiffs(["y".repeat(5_000)], 100).startsWith("y".repeat(100)));
  });
});

describe("activity filtering", () => {
  const NOW = Date.parse("2026-11-07T12:00:00Z");
  const ev = (id: string, minsAgo: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({
    id,
    at: NOW - minsAgo * 60_000,
    kind: "agent-start",
    actor: "agent",
    title: id,
    ...over,
  });
  const events = [
    ev("old", 300, { workspaceId: "s1" }),
    ev("pr", 30, { kind: "pr-raised", workspaceId: "s1" }),
    ev("turn", 20, { kind: "agent-turn-end", workspaceId: "s1" }),
    ev("ticket", 10, { kind: "transition", issueKey: "ENG-7", actor: "user" }),
    ev("other", 5, { workspaceId: "s2" }),
  ];
  const q = { kinds: [], workspaces: [], limit: 50 };

  it("reads since as a span or an ISO time", () => {
    assert.equal(parseSince("last 2h", NOW), NOW - 7_200_000);
    assert.equal(parseSince("90m", NOW), NOW - 5_400_000);
    assert.equal(parseSince("3 days", NOW), NOW - 3 * 86_400_000);
    assert.equal(parseSince("2026-11-07T09:00:00Z", NOW), Date.parse("2026-11-07T09:00:00Z"));
    // No zone: UTC, like the times read_activity prints.
    assert.equal(parseSince("2026-11-07T09:00", NOW), Date.parse("2026-11-07T09:00:00Z"));
    assert.equal(parseSince("2026-11-07T09:00+01:00", NOW), Date.parse("2026-11-07T08:00:00Z"));
    for (const bad of ["yesterday", "12345", "last 2 fortnights", ""]) {
      assert.throws(() => parseSince(bad, NOW), /isn't a time/, bad);
    }
  });

  it("filters by since, kind, session and ticket, newest first, capped", () => {
    const ids = (q2: Parameters<typeof filterActivity>[1]) =>
      filterActivity(events, q2).map((e) => e.id);
    assert.deepEqual(ids(q), ["other", "ticket", "pr", "old"], "turn-ends left out by default");
    assert.deepEqual(ids({ ...q, since: parseSince("last 1h", NOW) }), ["other", "ticket", "pr"]);
    assert.deepEqual(ids({ ...q, kinds: ["agent-turn-end"] }), ["turn"]);
    assert.deepEqual(ids({ ...q, workspaces: ["s1"] }), ["pr", "old"]);
    assert.deepEqual(ids({ ...q, ticket: "eng-7" }), ["ticket"]);
    assert.deepEqual(ids({ ...q, limit: 2 }), ["other", "ticket"]);
  });

  it("prints one line per event", () => {
    assert.equal(
      activityLine(events[3]),
      "2026-11-07T11:50:00Z · transition · user · ENG-7 · ticket"
    );
  });
});

describe("pickRepo", () => {
  const repos = ["/Users/r/IdeaProjects/terminal", "/Users/r/IdeaProjects/frontend"];

  it("takes a folder name or a path, any case", () => {
    assert.equal(pickRepo(repos, "Terminal"), repos[0]);
    assert.equal(pickRepo(repos, " /Users/r/IdeaProjects/frontend "), repos[1]);
  });

  it("names the choices when nothing matches", () => {
    assert.throws(
      () => pickRepo(repos, "infra"),
      /No repo matches "infra". Choose from: terminal, frontend\./
    );
  });

  it("lists paths when two repos share a folder name", () => {
    const twins = ["/a/app", "/b/app"];
    assert.equal(repoChoices(twins), "/a/app, /b/app");
    assert.throws(() => pickRepo(twins, "app"), /More than one repo matches/);
    assert.equal(pickRepo(twins, "/b/app"), "/b/app");
  });
});
