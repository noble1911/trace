// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityEvent } from "@/domains/activity/types";
import type { TranscriptItem } from "@/ipc/transcript";
import { COOLDOWN_MS, HOURLY_CAP, waitBeforeRecap } from "./gate.ts";
import { buildRecapPrompt, parseRecap, transcriptAsText } from "./prompt.ts";
import { agoLabel, sinceLine } from "./since.ts";

const prev = { goal: "Ship billing export", done: "Client swapped", now: "Tests", next: "PR" };

describe("parseRecap", () => {
  it("reads the four lines, tolerating markdown and bullets", () => {
    const raw = "**Goal:** Move export\n- Done: 3 endpoints\nNow: fixing refunds\nnext - raise PR";
    assert.deepEqual(parseRecap(raw, null), {
      goal: "Move export",
      done: "3 endpoints",
      now: "fixing refunds",
      next: "raise PR",
    });
  });

  it("keeps the previous recap's lines it didn't repeat", () => {
    assert.deepEqual(parseRecap("Now: waiting on review", prev), {
      ...prev,
      now: "waiting on review",
    });
  });

  it("is null without a Now line", () => {
    assert.equal(parseRecap("Goal: x\nDone: y", prev), null);
    assert.equal(parseRecap("", null), null);
  });
});

describe("transcriptAsText", () => {
  const items: TranscriptItem[] = [
    { kind: "prompt", id: "1", text: "Add a refunds endpoint", at: null },
    {
      kind: "toolCall",
      id: "2",
      toolUseId: "t",
      name: "Bash",
      input: { command: "npm test" },
      at: null,
    },
    { kind: "toolResult", id: "3", toolUseId: "t", text: "ok", isError: false },
    { kind: "toolResult", id: "4", toolUseId: "t", text: "boom", isError: true },
    { kind: "reply", id: "5", text: "Done.", at: null },
    { kind: "turnEnd", id: "6", durationMs: 10 },
  ];

  it("keeps prompts, replies, tool calls and errors, drops ok results", () => {
    assert.equal(
      transcriptAsText(items),
      "User: Add a refunds endpoint\n[tool Bash] npm test\n[tool error] boom\nAgent: Done.\n--- turn ended ---"
    );
  });

  it("keeps the newest end when over the limit", () => {
    assert.equal(transcriptAsText(items, 32), "Agent: Done.\n--- turn ended ---");
  });
});

describe("buildRecapPrompt", () => {
  it("leads with the previous recap and the agent's note", () => {
    const p = buildRecapPrompt(prev, "Agent: hi", "Migrated 4 of 4");
    assert.match(p, /^Previous recap:\nGoal: Ship billing export/);
    assert.match(p, /status note: Migrated 4 of 4/);
    assert.match(p, /Conversation since that recap \(oldest first\):\nAgent: hi$/);
  });
});

describe("waitBeforeRecap", () => {
  it("runs at once the first time, then waits out the cooldown", () => {
    assert.equal(waitBeforeRecap(0, [], 1000), 0);
    assert.equal(waitBeforeRecap(1000, [], 1000 + 30_000), COOLDOWN_MS - 30_000);
    assert.equal(waitBeforeRecap(1000, [], 1000 + COOLDOWN_MS + 1), 0);
  });

  it("lets ↻ skip the cooldown but never the hourly cap", () => {
    assert.equal(waitBeforeRecap(1000, [], 2000, true), 0);
    const full = Array.from({ length: HOURLY_CAP }, (_, i) => 10_000 + i);
    assert.equal(waitBeforeRecap(0, full, 20_000, true), null);
    assert.equal(waitBeforeRecap(0, full, 10_000 + 3_600_000 + HOURLY_CAP), 0);
  });
});

describe("sinceLine", () => {
  const ev = (
    at: number,
    kind: ActivityEvent["kind"],
    title: string,
    actor: ActivityEvent["actor"] = "agent"
  ): ActivityEvent => ({
    id: String(at),
    at,
    kind,
    actor,
    workspaceId: "TRACE-1",
    title,
  });

  it("counts turns and lists news in order, once each", () => {
    const events = [
      ev(30, "checks-passed", "CI passed on #12"),
      ev(10, "agent-turn-end", "finished a turn"),
      ev(20, "pr-raised", "raised a PR"),
      ev(25, "agent-turn-end", "finished a turn"),
      ev(5, "pr-raised", "raised a PR"),
    ];
    assert.equal(
      sinceLine(events, "TRACE-1", 8),
      "Finished 2 turns · raised a PR · CI passed on #12"
    );
  });

  it("ignores the user's own actions, other agents and never-seen workspaces", () => {
    const events = [
      ev(10, "transition", "→ Done", "user"),
      { ...ev(11, "pr-raised", "x"), workspaceId: "B" },
    ];
    assert.equal(sinceLine(events, "TRACE-1", 1), null);
    assert.equal(sinceLine([ev(10, "pr-raised", "raised a PR")], "TRACE-1", 0), null);
  });

  it("leaves out what happened after the visit began", () => {
    const events = [ev(10, "pr-raised", "raised a PR"), ev(50, "checks-failed", "CI failed on #3")];
    assert.equal(sinceLine(events, "TRACE-1", 5, 20), "Raised a PR");
  });
});

describe("agoLabel", () => {
  it("rounds to minutes, hours, then days", () => {
    assert.equal(agoLabel(0, 5 * 60_000), "5m");
    assert.equal(agoLabel(0, 2 * 3_600_000), "2h");
    assert.equal(agoLabel(0, 72 * 3_600_000), "3d");
  });
});
