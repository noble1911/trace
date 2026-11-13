// Run: `npm test` (node's own runner; Node strips the types).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JournalRow } from "../types.ts";
import { createListenerStarter, type LoadDeps, loadJournalOnce } from "./journalLoad.ts";

const row = (id: string): JournalRow => ({
  id,
  seq: 1,
  revision: 1,
  at: 1,
  body: { kind: "message", role: "assistant", text: id, streaming: false },
});

function harness(load: LoadDeps["load"]) {
  const rows: Record<string, JournalRow[]> = {};
  const loaded: Record<string, boolean> = {};
  const errors: unknown[] = [];
  const deps: LoadDeps = {
    load,
    applyRows: (ws, r) => {
      rows[ws] = r;
    },
    markLoaded: (ws) => {
      loaded[ws] = true;
    },
    noteRows: () => {},
    fail: (e) => errors.push(e),
  };
  return { rows, loaded, errors, deps };
}

describe("loadJournalOnce", () => {
  it("a view left mid-load still gets its rows in, so coming back needs no reload", async () => {
    const fetched = new Set<string>();
    let release: (r: JournalRow[]) => void = () => {};
    const h = harness(() => new Promise((res) => (release = res)));
    let cancelled = false;
    const first = loadJournalOnce("ws", fetched, h.deps, () => cancelled);
    cancelled = true; // unmount while the read is in flight
    release([row("a")]);
    await first;
    assert.deepEqual(h.rows.ws, [row("a")]);
    assert.equal(h.loaded.ws, true);
    assert.equal(fetched.has("ws"), true);
  });

  it("a read that fails after unmount is neither fetched nor reported, so it retries", async () => {
    const fetched = new Set<string>();
    const h = harness(() => Promise.reject(new Error("boom")));
    await loadJournalOnce("ws", fetched, h.deps, () => true);
    assert.equal(fetched.has("ws"), false);
    assert.equal(h.errors.length, 0);
    assert.equal(h.loaded.ws, undefined);
  });

  it("a failed read in a live view is reported and marks loaded, but not fetched", async () => {
    const fetched = new Set<string>();
    const h = harness(() => Promise.reject(new Error("boom")));
    await loadJournalOnce("ws", fetched, h.deps, () => false);
    assert.equal(h.errors.length, 1);
    assert.equal(h.loaded.ws, true);
    assert.equal(fetched.has("ws"), false);
  });
});

describe("createListenerStarter", () => {
  const flush = () => new Promise((r) => setImmediate(r));

  it("a failed journal listener retries alone, and each failure is reported", async () => {
    let journalCalls = 0;
    let infoCalls = 0;
    const failed: string[] = [];
    const start = createListenerStarter({
      onJournal: () => {
        journalCalls++;
        return journalCalls === 1 ? Promise.reject(new Error("x")) : Promise.resolve();
      },
      onInfo: () => {
        infoCalls++;
        return Promise.resolve();
      },
      handleJournal: () => {},
      handleInfo: () => {},
      fail: (which) => failed.push(which),
    });
    start();
    await flush();
    start();
    await flush();
    start();
    assert.equal(journalCalls, 2);
    assert.equal(infoCalls, 1);
    assert.deepEqual(failed, ["agent-journal"]);
  });

  it("a failed session-info listener is reported and retried", async () => {
    let infoCalls = 0;
    const failed: string[] = [];
    const start = createListenerStarter({
      onJournal: () => Promise.resolve(),
      onInfo: () => {
        infoCalls++;
        return infoCalls === 1 ? Promise.reject(new Error("x")) : Promise.resolve();
      },
      handleJournal: () => {},
      handleInfo: () => {},
      fail: (which) => failed.push(which),
    });
    start();
    await flush();
    start();
    assert.equal(infoCalls, 2);
    assert.deepEqual(failed, ["agent-session-info"]);
  });
});
