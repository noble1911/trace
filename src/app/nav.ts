import type { ProviderKind, ProviderSession } from "@/domains/issues/types";

export type NavId =
  | "inbox"
  | "board"
  | "pylon"
  | "boards"
  | "fleet"
  | "sessions"
  | "scheduled"
  | "pr"
  | "activity"
  | "integrations"
  | "settings";

export const NAV_LABELS: Record<NavId, string> = {
  inbox: "inbox",
  board: "board",
  pylon: "pylon",
  boards: "boards",
  fleet: "fleet",
  sessions: "sessions",
  scheduled: "scheduled",
  pr: "pull requests",
  activity: "activity",
  integrations: "integrations",
  settings: "settings",
};

type TrackerSessions = Partial<Record<ProviderKind, ProviderSession>>;

/** Pages that show a tracker's data, and so only exist while it's connected. Only Jira
 * reports linked pull requests. */
const NAV_TRACKER: Partial<Record<NavId, ProviderKind>> = {
  board: "jira",
  pylon: "pylon",
  pr: "jira",
};

/** The tracker a page's data comes from, if any. */
export function navTracker(nav: NavId): ProviderKind | undefined {
  return NAV_TRACKER[nav];
}

/** Pages that show a board, and whose boards they list. Boards (trace's own) needs no
 * connection, so it's here and not in `NAV_TRACKER`: it's always available. */
const NAV_BOARDS: Partial<Record<NavId, ProviderKind>> = {
  board: "jira",
  pylon: "pylon",
  boards: "custom",
};

/** The tracker whose boards a board page shows, or undefined for a page without one. */
export function navBoardProvider(nav: NavId): ProviderKind | undefined {
  return NAV_BOARDS[nav];
}

/** Whether a page can be shown: its tracker is connected, or the user keeps it on the
 * rail anyway (`pinned`, Settings → Sidebar), when it says how to connect one. */
export function isNavAvailable(
  nav: NavId,
  trackers: TrackerSessions,
  pinned: readonly NavId[] = []
): boolean {
  const tracker = NAV_TRACKER[nav];
  return !tracker || Boolean(trackers[tracker]) || pinned.includes(nav);
}

/** Where to go when the wanted page isn't available: a board if there is one. */
export function landingNav(trackers: TrackerSessions): NavId {
  if (trackers.jira) return "board";
  if (trackers.pylon) return "pylon";
  return "sessions";
}

/** The page to show: the wanted one, unless its tracker isn't connected (and it isn't pinned). */
export function resolveNav(
  nav: NavId,
  trackers: TrackerSessions,
  pinned: readonly NavId[] = []
): NavId {
  return isNavAvailable(nav, trackers, pinned) ? nav : landingNav(trackers);
}
