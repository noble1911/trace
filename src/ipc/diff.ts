import { invoke } from "@tauri-apps/api/core";

export interface FileSummary {
  path: string;
  add: number;
  del: number;
}

export interface DiffSummary {
  /** The ref we diffed against, e.g. `origin/main`. */
  base: string;
  files: FileSummary[];
}

export interface DiffLine {
  /** "ctx" (context) | "add" | "del" */
  kind: "ctx" | "add" | "del";
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  add: number;
  del: number;
  hunks: Hunk[];
}

export function gitDiffSummary(issueKey: string): Promise<DiffSummary> {
  return invoke("git_diff_summary", { issueKey });
}

export function gitDiffFile(issueKey: string, path: string): Promise<FileDiff> {
  return invoke("git_diff_file", { issueKey, path });
}
