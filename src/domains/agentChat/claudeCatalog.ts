import { useEffect } from "react";
import { create } from "zustand";
import { type ClaudeCatalog, type ClaudeModel, claudeCatalog } from "@/ipc/claudeCatalog";

// What the installed Claude Code offers, asked of the CLI once, on first use: its
// models, for every model picker (the composer's pill, the New session dialog),
// and what its slash commands do, for the composer's `/` menu. A new model or
// command arrives with a CLI update, so it appears without a trace release. Until
// it answers, or if it can't, pickers fall back to Claude's aliases
// (`CLAUDE_MODEL_ALIASES`) and the menu to the commands' bare names.

interface CatalogState extends ClaudeCatalog {
  load: () => void;
}

let asked = false;
/** The read in flight (or last finished), for `catalogModels` to wait on. */
let pending: Promise<void> | null = null;

export const useClaudeCatalog = create<CatalogState>((set) => ({
  models: [],
  commands: [],
  load: () => {
    if (asked) return;
    asked = true;
    pending = claudeCatalog()
      .then((catalog) => set(catalog))
      .catch(() => {
        // No CLI, or it didn't answer: keep the fallbacks, and try again next time.
        asked = false;
      });
  },
}));

/**
 * Claude Code's models for a choice that can't wait for a re-render (the assistant's
 * API id): asked for if they haven't been, and waited on for up to `waitMs`. Empty when
 * it doesn't answer in time, which callers answer with their fallbacks.
 */
export async function catalogModels(waitMs: number): Promise<ClaudeModel[]> {
  const { models, load } = useClaudeCatalog.getState();
  if (models.length > 0) return models;
  load();
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  if (pending) await Promise.race([pending, timeout]);
  return useClaudeCatalog.getState().models;
}

function useLoaded(): void {
  const load = useClaudeCatalog((s) => s.load);
  useEffect(() => load(), [load]);
}

/** Claude Code's models, loaded on first use. Empty until they arrive. */
export function useClaudeModels(): ClaudeModel[] {
  useLoaded();
  return useClaudeCatalog((s) => s.models);
}

/** What each of Claude Code's slash commands does, by name. Empty until it arrives. */
export function useCommandDetails(): ClaudeCatalog["commands"] {
  useLoaded();
  return useClaudeCatalog((s) => s.commands);
}

import.meta.hot?.accept(() => location.reload());
