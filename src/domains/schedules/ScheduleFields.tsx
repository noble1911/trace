import { formatWhen, WEEKDAY_SHORT } from "./describe";
import { useSchedulePreview } from "./hooks/useSchedulePreview";
import type { IntervalUnit, Schedule, ScheduleKind } from "./types";

const KINDS: { kind: ScheduleKind; label: string }[] = [
  { kind: "interval", label: "Every…" },
  { kind: "daily", label: "Daily" },
  { kind: "weekly", label: "Weekly" },
  { kind: "monthly", label: "Monthly" },
  { kind: "cron", label: "Cron" },
];

/** Switch kinds, carrying the time of day across where both kinds have one. */
function withKind(prev: Schedule, kind: ScheduleKind): Schedule {
  const time = "time" in prev ? prev.time : "09:00";
  switch (kind) {
    case "interval":
      return { kind, every: 1, unit: "hours" };
    case "daily":
      return { kind, time };
    case "weekly":
      return { kind, weekdays: [1, 2, 3, 4, 5], time };
    case "monthly":
      return { kind, day: 1, time };
    case "cron":
      return { kind, expr: "0 9 * * 1-5" };
  }
}

/** Parse a number input, clamped; keeps the old value while the field is mid-edit. */
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
}

interface ScheduleFieldsProps {
  value: Schedule;
  onChange: (next: Schedule) => void;
  /** The saved anchor, when editing a prompt whose schedule is unchanged. */
  anchorAt?: number;
}

// The "when" part of the scheduled-prompt form: a kind picker, the inputs for
// that kind, and a live preview of the next firings (validated backend-side).
export function ScheduleFields({ value, onChange, anchorAt }: ScheduleFieldsProps) {
  const preview = useSchedulePreview(value, anchorAt);

  const timeInput = (time: string, set: (time: string) => void) => (
    <input
      className="field-input sched-time"
      type="time"
      aria-label="Time of day"
      value={time}
      onChange={(e) => set(e.target.value)}
    />
  );

  return (
    <div className="field">
      <span className="field-label">Schedule</span>
      <div className="sched-kinds" role="tablist" aria-label="Schedule type">
        {KINDS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={value.kind === kind}
            className={`sched-kind${value.kind === kind ? " active" : ""}`}
            onClick={() => value.kind !== kind && onChange(withKind(value, kind))}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="sched-inputs">
        {value.kind === "interval" && (
          <>
            <span className="sched-word">Every</span>
            <input
              className="field-input sched-num"
              type="number"
              min={1}
              aria-label="Interval"
              value={value.every}
              onChange={(e) =>
                onChange({ ...value, every: clampInt(e.target.value, 1, 10_000, value.every) })
              }
            />
            <select
              className="field-input"
              aria-label="Interval unit"
              value={value.unit}
              onChange={(e) => onChange({ ...value, unit: e.target.value as IntervalUnit })}
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </>
        )}
        {value.kind === "daily" && (
          <>
            <span className="sched-word">At</span>
            {timeInput(value.time, (time) => onChange({ ...value, time }))}
          </>
        )}
        {value.kind === "weekly" && (
          <>
            <div className="sched-days">
              {WEEKDAY_SHORT.map((name, day) => {
                const on = value.weekdays.includes(day);
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    className={`sched-day${on ? " on" : ""}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        weekdays: on
                          ? value.weekdays.filter((d) => d !== day)
                          : [...value.weekdays, day].sort((a, b) => a - b),
                      })
                    }
                  >
                    {name.slice(0, 2)}
                  </button>
                );
              })}
            </div>
            <span className="sched-word">at</span>
            {timeInput(value.time, (time) => onChange({ ...value, time }))}
          </>
        )}
        {value.kind === "monthly" && (
          <>
            <span className="sched-word">Day</span>
            <input
              className="field-input sched-num"
              type="number"
              min={1}
              max={31}
              aria-label="Day of month"
              value={value.day}
              onChange={(e) =>
                onChange({ ...value, day: clampInt(e.target.value, 1, 31, value.day) })
              }
            />
            <span className="sched-word">at</span>
            {timeInput(value.time, (time) => onChange({ ...value, time }))}
          </>
        )}
        {value.kind === "cron" && (
          <input
            className="field-input sched-cron"
            type="text"
            spellCheck={false}
            aria-label="Cron expression"
            placeholder="minute hour day month weekday"
            value={value.expr}
            onChange={(e) => onChange({ ...value, expr: e.target.value })}
          />
        )}
      </div>

      {preview.error ? (
        <div className="sched-preview error">{preview.error}</div>
      ) : (
        <div className="sched-preview">
          {preview.next.length > 0 && <>Next: {preview.next.map(formatWhen).join(" · ")}</>}
        </div>
      )}
      {value.kind === "cron" && (
        <div className="field-note">
          5 fields in local time: minute hour day-of-month month weekday — e.g.{" "}
          <code>*/30 9-17 * * 1-5</code> is every half hour, 9–5 on weekdays.
        </div>
      )}
    </div>
  );
}
