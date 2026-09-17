import { useEffect, useState } from "react";
import { previewSchedule } from "@/ipc/schedules";
import type { Schedule } from "../types";

export interface SchedulePreview {
  /** Next firings (epoch secs); empty while loading or invalid. */
  next: number[];
  /** The backend's validation message, or null when the schedule is valid. */
  error: string | null;
}

// Debounced so typing a cron expression doesn't round-trip on every keystroke.
const DEBOUNCE_MS = 250;

/**
 * Validate a schedule and preview its next firings. The backend does both, so
 * the form can't disagree with what the runner will actually do (cron parsing,
 * DST, month clamping all live in one place).
 */
export function useSchedulePreview(schedule: Schedule, anchorAt?: number): SchedulePreview {
  const [preview, setPreview] = useState<SchedulePreview>({ next: [], error: null });
  // Stable key for the effect — the schedule object is rebuilt on every edit.
  const key = JSON.stringify(schedule);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      previewSchedule(JSON.parse(key) as Schedule, anchorAt)
        .then((next) => {
          if (!cancelled) setPreview({ next, error: null });
        })
        .catch((err) => {
          if (!cancelled) setPreview({ next: [], error: String(err) });
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, anchorAt]);

  return preview;
}
