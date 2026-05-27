export type NavId = "board" | "sessions" | "pr" | "activity" | "settings";

export const NAV_LABELS: Record<NavId, string> = {
  board: "board",
  sessions: "sessions",
  pr: "pull requests",
  activity: "activity",
  settings: "settings",
};
