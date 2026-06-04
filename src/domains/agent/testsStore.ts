import { create } from "zustand";
import { runTests, type TestRun } from "@/ipc/tests";

// Test runs live here, keyed by issue key, so they survive tab switches (the
// TestsPane unmounts when you leave the tab). The run() action owns the in-flight
// promise at module scope, so the run keeps going and its result lands here even
// while the pane is unmounted.
interface TestsStore {
  running: Set<string>;
  results: Record<string, TestRun>;
  errors: Record<string, string>;
  run: (issueKey: string) => Promise<void>;
}

export const useTestsStore = create<TestsStore>((set, get) => ({
  running: new Set(),
  results: {},
  errors: {},
  async run(issueKey) {
    if (get().running.has(issueKey)) return; // already running — no double-run
    set((s) => {
      const running = new Set(s.running).add(issueKey);
      const errors = { ...s.errors };
      delete errors[issueKey];
      return { running, errors };
    });
    try {
      const result = await runTests(issueKey);
      set((s) => {
        const running = new Set(s.running);
        running.delete(issueKey);
        return { running, results: { ...s.results, [issueKey]: result } };
      });
    } catch (e) {
      set((s) => {
        const running = new Set(s.running);
        running.delete(issueKey);
        const results = { ...s.results };
        delete results[issueKey];
        return { running, errors: { ...s.errors, [issueKey]: String(e) } };
      });
    }
  },
}));
