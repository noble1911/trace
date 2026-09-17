//! When a schedule fires. `Schedule` is the user-facing shape the form edits;
//! `next_after` turns it into a concrete instant. Wall-clock kinds (daily,
//! weekly, monthly, cron) are evaluated in local time; intervals are plain
//! epoch arithmetic, so they're immune to DST shifts.

use chrono::{
    Datelike, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime, TimeZone, Timelike,
};
use serde::{Deserialize, Serialize};

use super::cron::CronExpr;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum IntervalUnit {
    Minutes,
    Hours,
    Days,
}

impl IntervalUnit {
    fn seconds(self) -> i64 {
        match self {
            IntervalUnit::Minutes => 60,
            IntervalUnit::Hours => 60 * 60,
            IntervalUnit::Days => 24 * 60 * 60,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Schedule {
    /// Every `every` units, aligned to the prompt's anchor time.
    Interval { every: u32, unit: IntervalUnit },
    /// Every day at `time` ("HH:MM", local).
    Daily { time: String },
    /// The given weekdays (0 = Sunday) at `time`.
    Weekly { weekdays: Vec<u8>, time: String },
    /// Day `day` of every month at `time` — clamped to the month's last day, so
    /// "the 31st" still fires in February.
    Monthly { day: u8, time: String },
    /// A 5-field cron expression in local time (`cron::CronExpr`).
    Cron { expr: String },
}

/// Upper bound on an interval (a year) — beyond that, use a date-based kind.
const MAX_INTERVAL_SECS: i64 = 366 * 24 * 60 * 60;

impl Schedule {
    /// Check the schedule can be saved, with a message fit to show on the form.
    /// Also rejects schedules that never fire (e.g. cron `0 0 31 2 *`).
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Schedule::Interval { every, unit } => {
                let secs = i64::from(*every) * unit.seconds();
                if *every == 0 || secs > MAX_INTERVAL_SECS {
                    return Err("Pick an interval between 1 minute and a year.".to_string());
                }
            }
            Schedule::Daily { time } => {
                parse_time(time)?;
            }
            Schedule::Weekly { weekdays, time } => {
                if weekdays.is_empty() || weekdays.iter().any(|d| *d > 6) {
                    return Err("Pick at least one weekday.".to_string());
                }
                parse_time(time)?;
            }
            Schedule::Monthly { day, time } => {
                if !(1..=31).contains(day) {
                    return Err("Pick a day of the month between 1 and 31.".to_string());
                }
                parse_time(time)?;
            }
            Schedule::Cron { expr } => {
                CronExpr::parse(expr)?;
            }
        }
        let now = super::now_secs();
        if self.next_after(now, now).is_none() {
            return Err("This schedule never fires.".to_string());
        }
        Ok(())
    }

    /// The first firing strictly after `after` (epoch secs). `anchor` aligns
    /// intervals: they fire at anchor + k·period, so a skipped or missed slot
    /// never shifts the ones after it.
    pub fn next_after(&self, after: i64, anchor: i64) -> Option<i64> {
        if let Schedule::Interval { every, unit } = self {
            let period = i64::from(*every) * unit.seconds();
            if period <= 0 {
                return None;
            }
            let k = if after < anchor {
                0
            } else {
                (after - anchor) / period + 1
            };
            return Some(anchor + k * period);
        }
        let mut from = Local.timestamp_opt(after, 0).single()?.naive_local();
        // A wall-clock match can land in a DST gap (that local time never
        // happens) — keep searching past it. A few hops always suffice.
        for _ in 0..8 {
            let next = self.next_local(from)?;
            match Local.from_local_datetime(&next) {
                LocalResult::Single(t) if t.timestamp() > after => return Some(t.timestamp()),
                LocalResult::Ambiguous(t, _) if t.timestamp() > after => {
                    return Some(t.timestamp())
                }
                _ => from = next,
            }
        }
        None
    }

    /// The next matching wall-clock time strictly after `after`. Timezone-free,
    /// which is what makes it unit-testable.
    fn next_local(&self, after: NaiveDateTime) -> Option<NaiveDateTime> {
        match self {
            Schedule::Interval { .. } => None,
            Schedule::Daily { time } => {
                let t = parse_time(time).ok()?;
                CronExpr::parse(&format!("{} {} * * *", t.minute(), t.hour()))
                    .ok()?
                    .next_after(after)
            }
            Schedule::Weekly { weekdays, time } => {
                let t = parse_time(time).ok()?;
                let days: Vec<String> = weekdays.iter().map(u8::to_string).collect();
                let expr = format!("{} {} * * {}", t.minute(), t.hour(), days.join(","));
                CronExpr::parse(&expr).ok()?.next_after(after)
            }
            Schedule::Monthly { day, time } => {
                let t = parse_time(time).ok()?;
                let (mut year, mut month) = (after.year(), after.month());
                for _ in 0..13 {
                    let d = u32::from(*day).min(days_in_month(year, month)?);
                    let candidate = NaiveDate::from_ymd_opt(year, month, d)?.and_time(t);
                    if candidate > after {
                        return Some(candidate);
                    }
                    (year, month) = if month == 12 {
                        (year + 1, 1)
                    } else {
                        (year, month + 1)
                    };
                }
                None
            }
            Schedule::Cron { expr } => CronExpr::parse(expr).ok()?.next_after(after),
        }
    }
}

fn parse_time(raw: &str) -> Result<NaiveTime, String> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M")
        .map_err(|_| format!("“{raw}” isn't a 24-hour time like 09:30."))
}

fn days_in_month(year: i32, month: u32) -> Option<u32> {
    let (y, m) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    Some(NaiveDate::from_ymd_opt(y, m, 1)?.pred_opt()?.day())
}

#[cfg(test)]
mod tests {
    use super::{IntervalUnit, Schedule};
    use chrono::NaiveDateTime;

    fn next(s: &Schedule, after: &str) -> Option<String> {
        let after = NaiveDateTime::parse_from_str(after, "%Y-%m-%d %H:%M").unwrap();
        s.next_local(after)
            .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
    }

    #[test]
    fn interval_aligns_to_anchor() {
        let s = Schedule::Interval {
            every: 15,
            unit: IntervalUnit::Minutes,
        };
        let anchor = 1_000_000;
        assert_eq!(s.next_after(anchor, anchor), Some(anchor + 900));
        assert_eq!(s.next_after(anchor - 50, anchor), Some(anchor));
        // Missed three slots (asleep): the next one stays on the anchor's grid.
        assert_eq!(
            s.next_after(anchor + 3 * 900 + 10, anchor),
            Some(anchor + 4 * 900)
        );
    }

    #[test]
    fn daily_and_weekly() {
        let daily = Schedule::Daily {
            time: "09:30".into(),
        };
        assert_eq!(
            next(&daily, "2026-09-17 09:29").as_deref(),
            Some("2026-09-17 09:30")
        );
        assert_eq!(
            next(&daily, "2026-09-17 09:30").as_deref(),
            Some("2026-09-18 09:30")
        );
        // Mon + Wed; 2026-09-17 is a Thursday.
        let weekly = Schedule::Weekly {
            weekdays: vec![1, 3],
            time: "08:00".into(),
        };
        assert_eq!(
            next(&weekly, "2026-09-17 12:00").as_deref(),
            Some("2026-09-21 08:00")
        );
    }

    #[test]
    fn monthly_clamps_to_short_months() {
        let s = Schedule::Monthly {
            day: 31,
            time: "18:00".into(),
        };
        assert_eq!(
            next(&s, "2027-02-01 00:00").as_deref(),
            Some("2027-02-28 18:00")
        );
        assert_eq!(
            next(&s, "2027-02-28 18:00").as_deref(),
            Some("2027-03-31 18:00")
        );
        assert_eq!(
            next(&s, "2026-12-31 19:00").as_deref(),
            Some("2027-01-31 18:00")
        );
    }

    #[test]
    fn validation_messages() {
        assert!(Schedule::Daily {
            time: "25:00".into()
        }
        .validate()
        .is_err());
        assert!(Schedule::Weekly {
            weekdays: vec![],
            time: "09:00".into()
        }
        .validate()
        .is_err());
        assert!(Schedule::Monthly {
            day: 0,
            time: "09:00".into()
        }
        .validate()
        .is_err());
        assert!(Schedule::Interval {
            every: 0,
            unit: IntervalUnit::Hours
        }
        .validate()
        .is_err());
        assert!(Schedule::Cron {
            expr: "0 0 31 2 *".into()
        }
        .validate()
        .is_err());
        assert!(Schedule::Cron {
            expr: "0 9 * * 1-5".into()
        }
        .validate()
        .is_ok());
    }
}
