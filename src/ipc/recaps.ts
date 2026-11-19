import { invoke } from "@tauri-apps/api/core";
import type { Recap } from "@/domains/recap/types";

// Typed wrappers around `commands/recaps.rs`: each agent's saved "where it's up
// to" (`recap.rs`, `recaps.json`). The renderer writes them (`domains/recap/engine`).

/** Every saved recap, by workspace id. */
export function listRecaps(): Promise<Record<string, Recap>> {
  return invoke("list_recaps");
}

/** Save one workspace's recap (its `seenAt` is kept as on file); returns it as stored. */
export function saveRecap(workspaceId: string, recap: Recap): Promise<Recap> {
  return invoke("save_recap", { workspaceId, recap });
}

/** The user opened this workspace at `at`; resolves to when they last had before (0 = never). */
export function markRecapSeen(workspaceId: string, at: number): Promise<number> {
  return invoke("mark_recap_seen", { workspaceId, at });
}
