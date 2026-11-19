// Run: `npm test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { backgroundItems } from "./background.ts";
import type { SubagentThread } from "./subagents.ts";
import type { BackgroundTask } from "./types.ts";

const thread = (callId: string, status: SubagentThread["status"], startedAt: number) =>
  ({ callId, status, startedAt, label: `${callId} job`, pending: false }) as SubagentThread;

const task = (taskId: string, startedAt: number, more: Partial<BackgroundTask> = {}) => ({
  taskId,
  kind: "shell" as const,
  description: "npm run dev",
  startedAt,
  callId: `call-${taskId}`,
  ...more,
});

describe("backgroundItems", () => {
  it("lists running subagents and tasks, oldest first", () => {
    const items = backgroundItems(
      [thread("a", "running", 30), thread("b", "done", 10)],
      [task("t1", 20)]
    );
    assert.deepEqual(
      items.map((i) => [i.key, i.kind, i.callId]),
      [
        ["task:t1", "shell", "call-t1"],
        ["sub:a", "subagent", "a"],
      ]
    );
  });

  it("names a task with no description by its kind, and keeps one with no call unstoppable", () => {
    const [item] = backgroundItems(
      [],
      [task("t1", 1, { description: " ", kind: "monitor", callId: undefined })]
    );
    assert.equal(item.label, "Monitor");
    assert.equal(item.callId, null);
  });

  it("is empty when nothing runs", () => {
    assert.deepEqual(backgroundItems([thread("a", "stopped", 1)], []), []);
  });
});
