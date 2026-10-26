export type NavId =
  | "inbox"
  | "board"
  | "fleet"
  | "sessions"
  | "scheduled"
  | "pr"
  | "activity"
  | "settings";

export const NAV_LABELS: Record<NavId, string> = {
  inbox: "inbox",
  board: "board",
  fleet: "fleet",
  sessions: "sessions",
  scheduled: "scheduled",
  pr: "pull requests",
  activity: "activity",
  settings: "settings",
};
