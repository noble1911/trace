import type { IntervalUnit, RunStatus, Schedule } from "./types";

// Pure display helpers: a schedule in words, and times relative to now.

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const UNIT_SINGULAR: Record<IntervalUnit, string> = {
  minutes: "minute",
  hours: "hour",
  days: "day",
};

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function weekdaysLabel(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "Every day";
  if (set.join() === "1,2,3,4,5") return "Weekdays";
  if (set.join() === "0,6") return "Weekends";
  return set.map((d) => WEEKDAY_SHORT[d] ?? "?").join(", ");
}

/** "Every 15 minutes", "Weekdays at 09:00", "Monthly on the 1st at 08:30". */
export function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case "interval":
      return s.every === 1 ? `Every ${UNIT_SINGULAR[s.unit]}` : `Every ${s.every} ${s.unit}`;
    case "daily":
      return `Daily at ${s.time}`;
    case "weekly":
      return `${weekdaysLabel(s.weekdays)} at ${s.time}`;
    case "monthly":
      return `Monthly on the ${ordinal(s.day)} at ${s.time}`;
    case "cron":
      return `Cron · ${s.expr}`;
  }
}

/** "in 3h", "in 12m", "5m ago", "2d ago". */
export function relative(epochSecs: number, nowSecs = Date.now() / 1000): string {
  const diff = epochSecs - nowSecs;
  const abs = Math.abs(diff);
  const span =
    abs < 60
      ? "<1m"
      : abs < 3600
        ? `${Math.floor(abs / 60)}m`
        : abs < 86400
          ? `${Math.floor(abs / 3600)}h`
          : `${Math.floor(abs / 86400)}d`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

/** "Thu 09:00" within the coming week, else "Sep 17, 09:00". */
export function formatWhen(epochSecs: number): string {
  const d = new Date(epochSecs * 1000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const daysAway = Math.abs(epochSecs - Date.now() / 1000) / 86400;
  if (daysAway < 6) return `${WEEKDAY_SHORT[d.getDay()]} ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** "45s", "3m 12s", "1h 04m". */
export function formatDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

export const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Finished",
  failed: "Failed",
  timedOut: "Timed out",
  stopped: "Stopped",
};
