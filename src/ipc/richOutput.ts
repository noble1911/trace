import { invoke } from "@tauri-apps/api/core";

// Typed wrappers for persisting the agent rich-output (HTML cards) panel. Shape
// mirrors the store's HtmlBlock; defined here (not imported from the domain) to
// keep the ipc layer free of a store→ipc→store import cycle.
export interface PersistedBlock {
  id: number;
  html: string;
}

/** Load saved cards, keyed by workspace id. Empty map on first run. */
export function loadRichOutput(): Promise<Record<string, PersistedBlock[]>> {
  return invoke<Record<string, PersistedBlock[]>>("load_rich_output");
}

/** Overwrite the saved cards with the store's current state. */
export function saveRichOutput(blocks: Record<string, PersistedBlock[]>): Promise<void> {
  return invoke<void>("save_rich_output", { blocks });
}
