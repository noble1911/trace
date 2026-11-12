import { BOARD_NAVS, type NavId } from "../../app/nav.ts";
import type { ProviderKind, ProviderSession } from "../issues/types.ts";
import { isEntryShown, type SidebarEntry, sidebarItem } from "./items.ts";
import { moveEntry, nudgeEntry } from "./prefs.ts";

// "Group boards under one button" (Settings → Sidebar, on by default): the board pages
// (Jira's, Pylon's and trace's own) become one Boards item on the rail and one row in
// Settings. The stored list keeps a row per page either way, so turning it off gives
// back the separate buttons, and an order saved before grouping existed loads as is.

/** The rail item that stands for every board page while they're grouped. */
export const BOARD_GROUP = "boardGroup";

/** One rail item: a page, or the board group. */
export type RailItem = NavId | typeof BOARD_GROUP;

type TrackerSessions = Partial<Record<ProviderKind, ProviderSession>>;

const isBoardPage = (id: NavId) => BOARD_NAVS.includes(id);
const isFixed = (id: NavId) => sidebarItem(id)?.isFixed === true;

/** Whether the board group is on the rail: while any board page would be. */
export function isGroupShown(entries: SidebarEntry[], trackers: TrackerSessions): boolean {
  return entries.some((e) => isBoardPage(e.id) && isEntryShown(e, trackers));
}

/**
 * The rail's items, in order, fixed ones (Settings) left out. Grouped, the board pages
 * are one item where the first of them is in the user's order (shown or not, so the
 * button doesn't move as a tracker connects), and it's there while any of them is.
 */
export function groupedRailItems(
  entries: SidebarEntry[],
  trackers: TrackerSessions,
  grouped: boolean
): RailItem[] {
  const out: RailItem[] = [];
  const groupShown = isGroupShown(entries, trackers);
  let placed = false;
  for (const e of entries) {
    if (isFixed(e.id)) continue;
    if (grouped && isBoardPage(e.id)) {
      if (!placed && groupShown) out.push(BOARD_GROUP);
      placed = true;
    } else if (isEntryShown(e, trackers)) out.push(e.id);
  }
  return out;
}

/** Settings → Sidebar's rows: one page each, or grouped, the board pages as one row. */
export function sidebarRows(entries: SidebarEntry[], grouped: boolean): SidebarEntry[][] {
  if (!grouped) return entries.map((e) => [e]);
  const rows: SidebarEntry[][] = [];
  let group: SidebarEntry[] | null = null;
  for (const e of entries) {
    if (!isBoardPage(e.id)) rows.push([e]);
    else if (group) group.push(e);
    else {
      group = [e];
      rows.push(group);
    }
  }
  return rows;
}

const rowOf = (rows: SidebarEntry[][], id: NavId) =>
  rows.findIndex((r) => r.some((e) => e.id === id));

/** Move the row holding `id` to just before the row holding `before` (null = last of the
 * movable rows). Grouped, the board pages move together, and end up side by side. */
export function moveRow(
  entries: SidebarEntry[],
  id: NavId,
  before: NavId | null,
  grouped: boolean
): SidebarEntry[] {
  if (!grouped) return moveEntry(entries, id, before);
  const rows = sidebarRows(entries, true);
  const from = rowOf(rows, id);
  if (from === -1 || isFixed(id) || (before !== null && rows[from].some((e) => e.id === before))) {
    return entries;
  }
  const row = rows[from];
  const rest = rows.filter((_, i) => i !== from);
  const firstFixed = rest.findIndex((r) => isFixed(r[0].id));
  const end = firstFixed === -1 ? rest.length : firstFixed;
  const target = before === null ? end : rowOf(rest, before);
  const at = target === -1 ? end : Math.min(target, end);
  return [...rest.slice(0, at), row, ...rest.slice(at)].flat();
}

/** Move the row holding `id` one place up (-1) or down (+1), never past a fixed row. */
export function nudgeRow(
  entries: SidebarEntry[],
  id: NavId,
  delta: -1 | 1,
  grouped: boolean
): SidebarEntry[] {
  if (!grouped) return nudgeEntry(entries, id, delta);
  const rows = sidebarRows(entries, true);
  const i = rowOf(rows, id);
  const j = i + delta;
  if (i === -1 || isFixed(id) || j < 0 || j >= rows.length || isFixed(rows[j][0].id)) {
    return entries;
  }
  const out = [...rows];
  [out[i], out[j]] = [out[j], out[i]];
  return out.flat();
}

/** Hide the group (every board page), or show it again: a hidden page goes back to its
 * built-in rule, and one the user pinned stays pinned. */
export function setGroupVisible(entries: SidebarEntry[], on: boolean): SidebarEntry[] {
  return entries.map((e) => {
    if (!isBoardPage(e.id)) return e;
    if (!on) return { ...e, visibility: "hidden" };
    return e.visibility === "hidden" ? { ...e, visibility: "auto" } : e;
  });
}

const KEY = "trace.sidebar.groupBoards";

export const DEFAULT_GROUP_BOARDS = true;

/** A stored value: on unless it says off, so nothing stored yet is on. */
export function parseGroupBoards(raw: unknown): boolean {
  return raw !== "off";
}

export function loadGroupBoards(): boolean {
  try {
    return parseGroupBoards(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_GROUP_BOARDS;
  }
}

export function saveGroupBoards(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // best-effort persistence, like the app's other view prefs
  }
}
