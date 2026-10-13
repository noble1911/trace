import { invoke } from "@tauri-apps/api/core";

// Typed wrappers around `commands/cleanup.rs` — workspace auto-cleanup.

export type CleanupScope = "sessions" | "tickets" | "both";

/** Mirrors `cleanup/settings.rs`. */
export interface CleanupSettings {
  /** Master switch; off by default. */
  enabled: boolean;
  /** Idle time before a workspace's checkout is deleted. */
  afterHours: number;
  scope: CleanupScope;
  /** Sessions qualify only once archived (in the recycle bin). */
  sessionsOnlyArchived: boolean;
  /** Tickets qualify only once their issue is in a Done status. */
  ticketsOnlyDone: boolean;
}

export interface CleanupItem {
  workspaceId: string;
  kind: "session" | "ticket";
  /** Session title or issue key. */
  label: string;
  path: string;
  /** Epoch secs of its last activity. */
  lastActive: number;
  /** Why it was kept despite qualifying; null = deleted (or would be). */
  held: string | null;
}

export interface CleanupReport {
  items: CleanupItem[];
}

export function getCleanupSettings(): Promise<CleanupSettings> {
  return invoke("get_cleanup_settings");
}

/** Save the rules; resolves to them as stored (idle period clamped). */
export function setCleanupSettings(settings: CleanupSettings): Promise<CleanupSettings> {
  return invoke("set_cleanup_settings", { settings });
}

/** What the saved rules would delete right now (nothing is deleted). */
export function previewCleanup(): Promise<CleanupReport> {
  return invoke("preview_cleanup");
}

/** Run one pass with the saved rules, even when auto-cleanup is off. */
export function runCleanupNow(): Promise<CleanupReport> {
  return invoke("run_cleanup_now");
}
