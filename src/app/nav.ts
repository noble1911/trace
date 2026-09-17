export type NavId = "board" | "sessions" | "scheduled" | "pr" | "activity" | "settings";

export const NAV_LABELS: Record<NavId, string> = {
  board: "board",
  sessions: "sessions",
  scheduled: "scheduled",
  pr: "pull requests",
  activity: "activity",
  settings: "settings",
};
