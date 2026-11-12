import { isNavAvailable, type NavId, navTracker } from "../../app/nav.ts";
import type { ProviderKind, ProviderSession } from "../issues/types.ts";

// What the rail can show, in its built-in order, and whether each item is on it now.
// Which items show, and in what order, is the user's (Settings → Sidebar; prefs.ts).

/**
 * `auto` follows the built-in rule: a tracker's page shows while that tracker is
 * connected, every other page always. `shown` and `hidden` override it.
 */
export type Visibility = "auto" | "shown" | "hidden";

export interface SidebarEntry {
  id: NavId;
  visibility: Visibility;
}

export interface SidebarItemDef {
  id: NavId;
  label: string;
  /** What the page is for, under its name in Settings. */
  desc: string;
  /** Always shown, at the rail's foot, so Settings can't be lost. */
  isFixed?: boolean;
}

export const SIDEBAR_ITEMS: SidebarItemDef[] = [
  { id: "inbox", label: "Inbox", desc: "Agents that need you, with a count." },
  { id: "board", label: "Board", desc: "Your Jira board's tickets." },
  { id: "pylon", label: "Pylon", desc: "Your Pylon issues." },
  { id: "boards", label: "Boards", desc: "Boards you make in trace, with your own columns." },
  { id: "fleet", label: "Fleet", desc: "Every running agent." },
  { id: "sessions", label: "Sessions", desc: "Sessions not tied to a ticket." },
  { id: "scheduled", label: "Scheduled prompts", desc: "Prompts that run on a schedule." },
  {
    id: "pr",
    label: "Pull requests",
    desc: "Pull requests your sessions and tickets raised, and those Jira links to the board.",
  },
  { id: "activity", label: "Activity", desc: "What trace and its agents have done." },
  { id: "integrations", label: "Integrations", desc: "Connect trackers, GitHub and more." },
  { id: "settings", label: "Settings", desc: "Always shown, at the bottom.", isFixed: true },
];

/** The board pages' one row in Settings → Sidebar while they're grouped. */
export const BOARD_GROUP_ITEM = {
  label: "Boards",
  desc: "Every board, Jira's, Pylon's and your own, under one button.",
};

export const DEFAULT_SIDEBAR: SidebarEntry[] = SIDEBAR_ITEMS.map((d) => ({
  id: d.id,
  visibility: "auto",
}));

const BY_ID = new Map(SIDEBAR_ITEMS.map((d) => [d.id, d]));

export function sidebarItem(id: NavId): SidebarItemDef | undefined {
  return BY_ID.get(id);
}

/** Each tracker's name in a sentence ("Jira ticket", "trace board ticket"). */
export const TRACKER_NAMES: Record<ProviderKind, string> = {
  jira: "Jira",
  pylon: "Pylon",
  custom: "trace board",
};

type TrackerSessions = Partial<Record<ProviderKind, ProviderSession>>;

/** Whether an entry is on the rail now. A fixed item always is. */
export function isEntryShown(entry: SidebarEntry, trackers: TrackerSessions): boolean {
  if (sidebarItem(entry.id)?.isFixed) return true;
  if (entry.visibility === "hidden") return false;
  return entry.visibility === "shown" || isNavAvailable(entry.id, trackers);
}

/** The rail's items, in order: shown ones only, fixed ones (Settings) left out. */
export function railItems(entries: SidebarEntry[], trackers: TrackerSessions): NavId[] {
  return entries
    .filter((e) => !sidebarItem(e.id)?.isFixed && isEntryShown(e, trackers))
    .map((e) => e.id);
}

/** Pages the user keeps on the rail even while their tracker isn't connected. */
export function pinnedPages(entries: SidebarEntry[]): NavId[] {
  return entries.filter((e) => e.visibility === "shown" && navTracker(e.id)).map((e) => e.id);
}
