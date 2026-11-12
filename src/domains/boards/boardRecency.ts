import { create } from "zustand";
import { parseLastOpened } from "./railBoardList";

// When each board was last opened, by board key ("jira:42", "custom:7"), so the rail's
// Boards group lists the ones you use first and its button goes back to the last one.
// A view preference: kept in localStorage, validated on load, best-effort on save.

const KEY = "trace.boardRecency";
/** Boards remembered at most; the longest unused are dropped past it. */
const MAX = 100;

function load(): Record<string, number> {
  try {
    return parseLastOpened(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
}

function save(lastOpened: Record<string, number>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lastOpened));
  } catch {
    // A view preference: it still applies this run.
  }
}

interface BoardRecency {
  lastOpened: Record<string, number>;
  /** Mark a board opened now. */
  touch: (key: string) => void;
  /** Forget a board (it was deleted). */
  forget: (key: string) => void;
}

export const useBoardRecency = create<BoardRecency>((set, get) => ({
  lastOpened: load(),
  touch(key) {
    const kept = Object.entries({ ...get().lastOpened, [key]: Date.now() })
      .sort(([, a], [, b]) => b - a)
      .slice(0, MAX);
    const lastOpened = Object.fromEntries(kept);
    save(lastOpened);
    set({ lastOpened });
  },
  forget(key) {
    if (!(key in get().lastOpened)) return;
    const { [key]: _gone, ...lastOpened } = get().lastOpened;
    save(lastOpened);
    set({ lastOpened });
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
