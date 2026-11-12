import { create } from "zustand";
import type { I } from "@/components/Icon";

/**
 * The icon a custom board shows instead of its type's glyph (Board settings → Icon), by
 * board key (`custom:<id>`): in the rail's Boards group, the topbar's board switcher and
 * the board's header.
 *
 * Kept frontend-side for now, in localStorage like the other view preferences, so it
 * stays on this machine. It belongs in the board's own record in the backend
 * (`custom_boards`), beside its name: move it there when that record next changes.
 */

/** The glyphs a board can take, in the picker's order. */
export const BOARD_ICON_CHOICES = [
  "Code",
  "Terminal",
  "Branch",
  "GitPR",
  "Layers",
  "Sparkles",
  "ListChecks",
  "Plan",
  "Bolt",
  "Plug",
  "Wrench",
  "Shield",
  "Beaker",
  "Globe",
  "Ticket",
  "Folder",
  "Images",
  "Chat",
  "Activity",
  "Pin",
] as const satisfies readonly (keyof typeof I)[];

export type BoardIconId = (typeof BOARD_ICON_CHOICES)[number];

/** Each glyph's name, for its button's label in the picker. */
export const BOARD_ICON_NAMES: Record<BoardIconId, string> = {
  Code: "Code",
  Terminal: "Terminal",
  Branch: "Branch",
  GitPR: "Pull request",
  Layers: "Layers",
  Sparkles: "Sparkles",
  ListChecks: "Checklist",
  Plan: "Plan",
  Bolt: "Bolt",
  Plug: "Plug",
  Wrench: "Wrench",
  Shield: "Shield",
  Beaker: "Beaker",
  Globe: "Globe",
  Ticket: "Ticket",
  Folder: "Folder",
  Images: "Images",
  Chat: "Chat",
  Activity: "Activity",
  Pin: "Pin",
};

const isBoardIconId = (v: unknown): v is BoardIconId =>
  typeof v === "string" && (BOARD_ICON_CHOICES as readonly string[]).includes(v);

const KEY = "trace.boardIcons";

/** Stored icons, keeping only custom boards' keys with a known glyph. */
export function parseBoardIcons(raw: unknown): Record<string, BoardIconId> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, BoardIconId> = {};
  for (const [key, id] of Object.entries(raw)) {
    if (key.startsWith("custom:") && isBoardIconId(id)) out[key] = id;
  }
  return out;
}

function load(): Record<string, BoardIconId> {
  try {
    return parseBoardIcons(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return {};
  }
}

interface BoardIcons {
  icons: Record<string, BoardIconId>;
  /** Set a board's icon, or null for its type's glyph (also how a deleted board's goes). */
  setIcon: (boardKey: string, id: BoardIconId | null) => void;
}

export const useBoardIcons = create<BoardIcons>((set, get) => ({
  icons: load(),
  setIcon(boardKey, id) {
    if (!id && !(boardKey in get().icons)) return;
    const { [boardKey]: _old, ...rest } = get().icons;
    const icons = id ? { ...rest, [boardKey]: id } : rest;
    try {
      localStorage.setItem(KEY, JSON.stringify(icons));
    } catch {
      // A view preference: it still applies this run.
    }
    set({ icons });
  },
}));

// A hot update would leave subscribers on a stale copy of this state, so reload instead.
import.meta.hot?.accept(() => location.reload());
