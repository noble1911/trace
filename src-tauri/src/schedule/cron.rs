//! A small 5-field cron parser: `minute hour day-of-month month day-of-week`.
//!
//! Hand-rolled rather than a crate: the common crates expect 6–7 fields
//! (seconds, years) nobody types, and all the scheduler needs is "the next
//! matching minute after X". Supports `*`, lists, ranges, steps and JAN–DEC /
//! SUN–SAT names. Day-of-month and day-of-week follow Vixie cron: when both are
//! restricted, a day matching *either* one fires.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};

const MONTHS: [&str; 12] = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];
const WEEKDAYS: [&str; 7] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/// How far ahead `next_after` searches — covers leap-day-only expressions.
const SEARCH_DAYS: u32 = 366 * 5;

/// A parsed expression: one bitset per field (bit n set = value n matches).
#[derive(Debug, Clone, PartialEq)]
pub struct CronExpr {
    minutes: u64,
    hours: u64,
    days: u64,
    months: u64,
    weekdays: u64,
    days_restricted: bool,
    weekdays_restricted: bool,
}

impl CronExpr {
    /// Parse an expression, with an error message fit to show next to the input.
    pub fn parse(expr: &str) -> Result<Self, String> {
        let fields: Vec<&str> = expr.split_whitespace().collect();
        if fields.len() != 5 {
            return Err(format!(
                "Cron needs 5 fields (minute hour day month weekday) — got {}.",
                fields.len()
            ));
        }
        // 7 is an accepted alias for Sunday — fold it onto 0.
        let weekdays = parse_field(fields[4], 0, 7, &WEEKDAYS, "weekday")?;
        Ok(Self {
            minutes: parse_field(fields[0], 0, 59, &[], "minute")?,
            hours: parse_field(fields[1], 0, 23, &[], "hour")?,
            days: parse_field(fields[2], 1, 31, &[], "day of month")?,
            months: parse_field(fields[3], 1, 12, &MONTHS, "month")?,
            weekdays: (weekdays | (weekdays >> 7)) & 0x7f,
            days_restricted: !is_unrestricted(fields[2]),
            weekdays_restricted: !is_unrestricted(fields[4]),
        })
    }

    /// The first matching minute strictly after `after` (seconds ignored), or
    /// `None` when nothing matches within five years (e.g. `0 0 31 2 *`).
    pub fn next_after(&self, after: NaiveDateTime) -> Option<NaiveDateTime> {
        let start = after.with_second(0)?.with_nanosecond(0)? + Duration::minutes(1);
        let mut date = start.date();
        for _ in 0..SEARCH_DAYS {
            if self.day_matches(date) {
                let first_day = date == start.date();
                for h in 0..24 {
                    if !has(self.hours, h) || (first_day && h < start.hour()) {
                        continue;
                    }
                    let from = if first_day && h == start.hour() {
                        start.minute()
                    } else {
                        0
                    };
                    if let Some(m) = (from..60).find(|m| has(self.minutes, *m)) {
                        return date.and_hms_opt(h, m, 0);
                    }
                }
            }
            date = date.succ_opt()?;
        }
        None
    }

    fn day_matches(&self, date: NaiveDate) -> bool {
        if !has(self.months, date.month()) {
            return false;
        }
        let dom = has(self.days, date.day());
        let dow = has(self.weekdays, date.weekday().num_days_from_sunday());
        match (self.days_restricted, self.weekdays_restricted) {
            (true, true) => dom || dow,
            (true, false) => dom,
            (false, true) => dow,
            (false, false) => true,
        }
    }
}

fn has(bits: u64, n: u32) -> bool {
    bits & (1 << n) != 0
}

/// Vixie cron treats a field starting with `*` (including `*/2`) as unrestricted
/// for the day-of-month/day-of-week OR rule.
fn is_unrestricted(field: &str) -> bool {
    field.starts_with('*') || field == "?"
}

fn parse_field(
    field: &str,
    min: u32,
    max: u32,
    names: &[&str],
    label: &str,
) -> Result<u64, String> {
    let mut bits = 0u64;
    for part in field.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => {
                let step = step
                    .parse::<u32>()
                    .ok()
                    .filter(|s| *s > 0)
                    .ok_or_else(|| format!("Bad step in the {label} field: “{part}”."))?;
                (range, step)
            }
            None => (part, 1),
        };
        let (lo, hi) = if range == "*" || range == "?" {
            (min, max)
        } else if let Some((a, b)) = range.split_once('-') {
            (
                value(a, min, max, names, label)?,
                value(b, min, max, names, label)?,
            )
        } else {
            let v = value(range, min, max, names, label)?;
            // "5/15" means 5, 20, 35, 50 — a start with a step runs to the max.
            (v, if part.contains('/') { max } else { v })
        };
        if lo > hi {
            return Err(format!("Backwards range in the {label} field: “{part}”."));
        }
        let mut v = lo;
        while v <= hi {
            bits |= 1 << v;
            v += step;
        }
    }
    Ok(bits)
}

fn value(raw: &str, min: u32, max: u32, names: &[&str], label: &str) -> Result<u32, String> {
    let upper = raw.to_ascii_uppercase();
    let parsed = names
        .iter()
        .position(|n| *n == upper)
        .map(|i| i as u32 + min)
        .or_else(|| raw.parse().ok());
    match parsed {
        Some(v) if (min..=max).contains(&v) => Ok(v),
        _ => Err(format!("“{raw}” isn't a valid {label} ({min}–{max}).")),
    }
}

#[cfg(test)]
mod tests {
    use super::CronExpr;
    use chrono::NaiveDateTime;

    fn at(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    fn next(expr: &str, after: &str) -> Option<String> {
        CronExpr::parse(expr)
            .unwrap()
            .next_after(at(after))
            .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
    }

    #[test]
    fn steps_and_strictly_after() {
        assert_eq!(
            next("*/15 * * * *", "2026-09-17 10:07").as_deref(),
            Some("2026-09-17 10:15")
        );
        // Exactly on a match → the *next* one.
        assert_eq!(
            next("*/15 * * * *", "2026-09-17 10:15").as_deref(),
            Some("2026-09-17 10:30")
        );
        assert_eq!(
            next("5/20 * * * *", "2026-09-17 10:06").as_deref(),
            Some("2026-09-17 10:25")
        );
    }

    #[test]
    fn weekday_ranges_names_and_rollover() {
        // 2026-09-18 is a Friday → weekday-only schedule jumps to Monday.
        assert_eq!(
            next("0 9 * * 1-5", "2026-09-18 10:00").as_deref(),
            Some("2026-09-21 09:00")
        );
        assert_eq!(
            next("30 8 * * mon,WED", "2026-09-17 09:00").as_deref(),
            Some("2026-09-21 08:30")
        );
        // 7 is Sunday too.
        assert_eq!(
            next("0 0 * * 7", "2026-09-17 09:00").as_deref(),
            Some("2026-09-20 00:00")
        );
        assert_eq!(
            next("0 0 1 JAN *", "2026-09-17 09:00").as_deref(),
            Some("2027-01-01 00:00")
        );
    }

    #[test]
    fn day_of_month_or_weekday_when_both_restricted() {
        // The 13th OR any Friday: Friday 18th comes before 13 October.
        assert_eq!(
            next("0 0 13 * 5", "2026-09-17 00:00").as_deref(),
            Some("2026-09-18 00:00")
        );
        // `*/2` counts as unrestricted, so only the weekday applies.
        assert_eq!(
            next("0 0 */2 * 5", "2026-09-17 00:00").as_deref(),
            Some("2026-09-18 00:00")
        );
    }

    #[test]
    fn impossible_dates_and_bad_input() {
        assert_eq!(next("0 0 31 2 *", "2026-09-17 00:00"), None);
        assert_eq!(
            next("0 0 29 2 *", "2026-09-17 00:00").as_deref(),
            Some("2028-02-29 00:00")
        );
        assert!(CronExpr::parse("* * * *").is_err());
        assert!(CronExpr::parse("60 * * * *").is_err());
        assert!(CronExpr::parse("*/0 * * * *").is_err());
        assert!(CronExpr::parse("10-5 * * * *").is_err());
        assert!(CronExpr::parse("0 0 * * FUNDAY").is_err());
    }
}
