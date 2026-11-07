// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "../activity/types.ts";
import type { JournalRow } from "../agentChat/types.ts";
import type { ScratchSession } from "../sessions/types.ts";
import { NO_BOARD_LINES, sessionSnapshotLines } from "./sessionSnapshot.ts";
import { computeSessionStats, type SessionStatsInput } from "./sessionStats.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const session = (id: string, over: Partial<ScratchSession> = {}): ScratchSession => ({
  id,
  title: `Session ${id}`,
  cli: "claude",
  createdAt: Math.floor((NOW - 30 * DAY) / 1000),
  repo: "C:\\src\\trace",
  ...over,
});

const event = (id: string, workspaceId: string, kind: ActivityEvent["kind"], at: number) =>
  ({ id, at, kind, actor: "agent", workspaceId, subject: "S", title: kind }) as ActivityEvent;

const turn = (id: string, costUsd?: number): JournalRow => ({
  id,
  revision: 1,
  seq: 1,
  at: NOW,
  body: {
    kind: "turn",
    turnId: id,
    state: "completed",
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 5000,
      cacheWriteTokens: 0,
      costUsd,
    },
  },
});

const input = (over: Partial<SessionStatsInput> = {}): SessionStatsInput => ({
  sessions: [],
  runningAgents: new Set(),
  lights: {},
  overview: {},
  journals: {},
  activity: [],
  now: NOW,
  ...over,
});

describe("computeSessionStats", () => {
  it("is all zeros with no sessions", () => {
    const s = computeSessionStats(input());
    assert.equal(s.total, 0);
    assert.deepEqual(s.agents, { total: 0, working: 0, needsYou: 0, ready: 0, stopped: 0 });
    assert.deepEqual(s.flags, []);
    assert.equal(s.chat.costUsd, null);
  });

  it("counts every agent's light, companions included, and skips archived sessions", () => {
    const s = computeSessionStats(
      input({
        sessions: [
          session("a", { agents: [{ id: "a2", cli: "codex" }] }),
          session("b"),
          session("c"),
          session("old", { archivedAt: 1 }),
        ],
        runningAgents: new Set(["a", "a2", "b", "old", "term:a"]),
        lights: { a: "working", a2: "attention", old: "working" },
      })
    );
    assert.equal(s.total, 3);
    assert.equal(s.archived, 1);
    // b runs with no light yet → ready; c isn't running → stopped.
    assert.deepEqual(s.agents, { total: 4, working: 1, needsYou: 1, ready: 1, stopped: 1 });
    assert.deepEqual(s.flags, ["1 session agent needs you"]);
  });

  it("groups sessions by repo or folder, most first", () => {
    const s = computeSessionStats(
      input({
        sessions: [
          session("a"),
          session("b", { repo: "/home/me/api" }),
          session("c"),
          session("d", { repo: null, folder: "C:\\scratch\\notes" }),
          session("e", { repo: null }),
        ],
      })
    );
    assert.deepEqual(s.repos, [
      { name: "trace", sessions: 2 },
      { name: "api", sessions: 1 },
      { name: "default repo", sessions: 1 },
      { name: "notes (folder)", sessions: 1 },
    ]);
  });

  it("counts PRs from the overview and the sessions not checked yet", () => {
    const pr = (n: number, state: "open" | "merged") => ({ number: n, state, url: `u${n}` });
    const s = computeSessionStats(
      input({
        sessions: [session("a"), session("b"), session("c"), session("d")],
        overview: {
          a: { id: "a", repo: "/r/trace", branch: "feat/x", pr: pr(1, "open") },
          b: { id: "b", repo: "/r/trace", branch: "feat/y", pr: pr(2, "merged") },
          c: { id: "c", repo: "/r/trace", branch: "main", pr: null },
        },
      })
    );
    assert.deepEqual(s.prs, { open: 1, draft: 0, merged: 1, closed: 0 });
    assert.equal(s.prsUnchecked, 1);
    assert.ok(s.flags.includes("1 session PR open"));
    assert.equal(s.rows.find((r) => r.id === "a")?.branch, "feat/x");
  });

  it("sums chat-agent usage from turn rows, cost only where reported", () => {
    const s = computeSessionStats(
      input({
        sessions: [session("a", { agents: [{ id: "a2", cli: "claude" }] }), session("b")],
        journals: {
          a: { rows: [turn("t1", 0.5), turn("t2", 0.25)] },
          a2: { rows: [turn("t3")] },
          b: { rows: [] },
          // Not a session's: a ticket agent's journal doesn't count here.
          "PM-1": { rows: [turn("t9", 9)] },
        },
      })
    );
    assert.deepEqual(s.chat, {
      agents: 2,
      turns: 3,
      inputTokens: 3000,
      outputTokens: 600,
      cachedTokens: 15000,
      costUsd: 0.75,
    });
  });

  it("reads the last 7 days and recent activity from session events only", () => {
    const s = computeSessionStats(
      input({
        sessions: [session("a", { createdAt: Math.floor((NOW - DAY) / 1000) }), session("b")],
        activity: [
          event("1", "a", "agent-turn-end", NOW - 5 * MIN),
          event("2", "a", "agent-needs-input", NOW - 10 * MIN),
          event("3", "b", "agent-turn-end", NOW - 8 * DAY),
          event("4", "PM-1", "agent-turn-end", NOW - MIN),
          event("5", "b", "agent-exit", NOW - 2 * DAY),
        ],
      })
    );
    assert.deepEqual(s.last7d, { created: 1, turnsEnded: 1, askedForInput: 1 });
    assert.deepEqual(
      s.recent.map((e) => e.id),
      ["2", "5"]
    );
    // Most recently active first: a (5m ago) before b (2d ago).
    assert.deepEqual(
      s.rows.map((r) => r.id),
      ["a", "b"]
    );
  });
});

describe("sessionSnapshotLines", () => {
  it("says there are no sessions", () => {
    const lines = sessionSnapshotLines(computeSessionStats(input()), NOW);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^SESSIONS: none active/);
  });

  it("describes sessions with deterministic numbers when no board is connected", () => {
    const stats = computeSessionStats(
      input({
        sessions: [session("a", { title: "Fix login" }), session("b", { title: "Docs" })],
        runningAgents: new Set(["a"]),
        lights: { a: "attention" },
        overview: { a: { id: "a", repo: "/r/trace", branch: "fix/login", pr: null } },
        activity: [event("1", "a", "agent-needs-input", NOW - 3 * MIN)],
      })
    );
    const text = [...NO_BOARD_LINES, "", ...sessionSnapshotLines(stats, NOW)].join("\n");
    assert.match(text, /^BOARD: none connected/);
    assert.match(text, /SESSIONS: 2 active · 0 archived · by repo: trace \(2\)/);
    assert.match(text, /SESSION AGENTS: 2 — 0 working · 1 need you · 0 ready · 1 stopped/);
    assert.match(text, /SESSION PRS: 0 open · 0 draft · 0 merged · 0 closed · 1 session\(s\) not/);
    assert.match(text, /CHAT AGENTS: no chat-agent turns recorded/);
    assert.match(text, /- a "Fix login" · trace · fix\/login · claude=needs you · active 3m ago/);
    assert.match(text, /- b "Docs" · trace · claude=stopped · active 30d ago/);
    assert.match(text, /RECENT SESSION ACTIVITY[^\n]*\n- 3m ago "S" agent-needs-input/);
    // Same state in, same text out.
    assert.equal(
      sessionSnapshotLines(stats, NOW).join("\n"),
      sessionSnapshotLines(stats, NOW).join("\n")
    );
  });
});
