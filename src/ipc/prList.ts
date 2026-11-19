import { invoke } from "@tauri-apps/api/core";

// Typed wrapper around `commands/pr_list.rs`: the PRs trace's workspaces raised.

/** A PR and the workspace (session, session agent or ticket) that raised it. */
export interface RaisedPr {
  workspaceId: string;
  url: string;
  number: number;
  state: "open" | "draft" | "merged" | "closed";
  title: string;
  /** Its head branch. */
  branch: string;
  /** Who opened it on GitHub; null for a deleted account. */
  author: string | null;
}

/**
 * Every PR the workspaces `ids` raised, plus every ticket trace has started (the
 * backend knows those): their branch's and every PR their conversations created,
 * in any repo. A couple of `gh` calls per repo.
 */
export async function raisedPrs(ids: string[]): Promise<RaisedPr[]> {
  const raw: unknown = await invoke("raised_prs", { ids });
  return Array.isArray(raw) ? raw.filter(isRaisedPr) : [];
}

const STATES: readonly string[] = ["open", "draft", "merged", "closed"];

/** A row the page can bucket and open; anything else is dropped, not trusted. */
function isRaisedPr(v: unknown): v is RaisedPr {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.workspaceId === "string" &&
    typeof p.url === "string" &&
    typeof p.number === "number" &&
    typeof p.state === "string" &&
    STATES.includes(p.state) &&
    typeof p.title === "string" &&
    typeof p.branch === "string" &&
    (p.author === null || typeof p.author === "string")
  );
}
