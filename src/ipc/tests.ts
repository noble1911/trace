import { invoke } from "@tauri-apps/api/core";

// Typed wrapper around the test-runner command.

export interface TestRun {
  command: string;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  output: string;
}

export function runTests(issueKey: string): Promise<TestRun> {
  return invoke("run_tests", { issueKey });
}
