import { invoke } from "@tauri-apps/api/core";
import type { ActivityEvent, ActivityInput } from "@/domains/activity/types";

// Typed wrappers around the activity-log commands (`commands/activity.rs`). New
// events arrive live via `onActivityEvent` (`ipc/events.ts`).

/** Newest-first events (default: all the backend keeps). */
export function listActivity(limit?: number): Promise<ActivityEvent[]> {
  return invoke("list_activity", { limit: limit ?? null });
}

/** Record a renderer-side action; it's also broadcast as `activity-event`. */
export function recordActivity(input: ActivityInput): Promise<ActivityEvent> {
  return invoke("record_activity", { input });
}

export function clearActivity(): Promise<void> {
  return invoke("clear_activity");
}

/** Seed an empty backend log (one-time move off localStorage); false if it had events. */
export function importActivity(events: ActivityEvent[]): Promise<boolean> {
  return invoke("import_activity", { events });
}
