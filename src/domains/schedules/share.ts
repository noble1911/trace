import type { ScheduledPrompt } from "./types";

// Pure helpers for sharing prompts through a file (`schedule::share` in Rust).

/** File-dialog filter for trace exports — plain JSON, readable before importing. */
export const SHARE_FILTERS = [{ name: "trace scheduled prompts", extensions: ["json"] }];

/** "1 prompt", "3 prompts". */
export function countLabel(n: number): string {
  return `${n} ${n === 1 ? "prompt" : "prompts"}`;
}

/** Suggested file name: the prompt's own name when exporting one, else a generic one. */
export function exportFileName(prompts: ScheduledPrompt[]): string {
  const only = prompts.length === 1 ? prompts[0] : undefined;
  const slug = only?.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "trace-scheduled-prompts"}.json`;
}
