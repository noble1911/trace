import { useEffect, useState } from "react";
import { useBoardStore } from "@/domains/board/store";
import type { BoardSettings } from "@/ipc/boardSettings";
import type { CardType } from "@/ipc/customBoards";
import { useBoardSetup } from "./store";

const NO_TYPES: CardType[] = [];

/** A board's settings from the cache, read once when first asked for. Undefined until
 * they've loaded (or when they can't be). */
export function useBoardSettings(boardKey: string | null): BoardSettings | undefined {
  const settings = useBoardSetup((s) => (boardKey ? s.settings[boardKey] : undefined));
  const load = useBoardSetup((s) => s.loadSettings);
  useEffect(() => {
    if (boardKey) void load(boardKey);
  }, [boardKey, load]);
  return settings;
}

/** A board's settings read fresh on mount, for a choice that must follow them (the repo
 * picker). `loaded` stays false until the read answers; `settings` is null when it can't. */
export function useFreshBoardSettings(boardKey: string | null): {
  settings: BoardSettings | null;
  loaded: boolean;
} {
  const [read, setRead] = useState<{ key: string | null; settings: BoardSettings | null }>();
  const load = useBoardSetup((s) => s.loadSettings);
  useEffect(() => {
    let live = true;
    const answer = boardKey ? load(boardKey, true) : Promise.resolve(null);
    void answer.then((settings) => {
      if (live) setRead({ key: boardKey, settings });
    });
    return () => {
      live = false;
    };
  }, [boardKey, load]);
  const loaded = read !== undefined && read.key === boardKey;
  return { settings: loaded ? read.settings : null, loaded };
}

/** A custom board's card types, read once when first asked for (none until then). */
export function useCardTypes(boardId: string | null): CardType[] {
  const types = useBoardSetup((s) => (boardId ? s.configs[boardId]?.cardTypes : undefined));
  const load = useBoardSetup((s) => s.loadConfig);
  useEffect(() => {
    if (boardId) void load(boardId);
  }, [boardId, load]);
  return types ?? NO_TYPES;
}

/** The card types of the custom board on screen (none on a tracker's board). */
export function useLoadedCardTypes(): CardType[] {
  const boardId = useBoardStore((s) =>
    s.provider === "custom" ? (s.data?.boardId ?? null) : null
  );
  return useCardTypes(boardId);
}

const NO_REPOS: string[] = [];

/** The configured repos, re-read each time a component asking for them mounts. */
export function useConfiguredRepos(): { repos: string[]; loaded: boolean } {
  const repos = useBoardSetup((s) => s.repos);
  const load = useBoardSetup((s) => s.loadRepos);
  useEffect(() => {
    void load();
  }, [load]);
  return { repos: repos ?? NO_REPOS, loaded: repos !== null };
}
