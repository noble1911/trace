//! Prompt variables, filled in when a run starts — so one saved prompt can say
//! "summarise what merged since {lastRunAt}" and mean something new each time.
//! Unknown `{placeholders}` are left as typed.

use chrono::{Local, TimeZone};

/// What a run knows about itself at launch.
pub struct Vars<'a> {
    /// The run's start (epoch secs).
    pub now: i64,
    /// The previous run's start, if there was one.
    pub last_run_at: Option<i64>,
    pub title: &'a str,
    pub repo: &'a str,
}

pub fn render(template: &str, vars: &Vars) -> String {
    let local = |secs: i64| Local.timestamp_opt(secs, 0).single();
    let now = local(vars.now);
    let fmt = |f: &str| now.map(|t| t.format(f).to_string()).unwrap_or_default();
    let last = vars
        .last_run_at
        .and_then(local)
        .map(|t| t.to_rfc3339())
        .unwrap_or_else(|| "never (this is the first run)".to_string());
    let repo_name = vars
        .repo
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(vars.repo);
    let values: [(&str, String); 7] = [
        ("date", fmt("%Y-%m-%d")),
        ("time", fmt("%H:%M")),
        ("weekday", fmt("%A")),
        ("now", now.map(|t| t.to_rfc3339()).unwrap_or_default()),
        ("lastRunAt", last),
        ("title", vars.title.to_string()),
        ("repo", repo_name.to_string()),
    ];
    values
        .iter()
        .fold(template.to_string(), |text, (name, value)| {
            text.replace(&format!("{{{name}}}"), value)
        })
}

#[cfg(test)]
mod tests {
    use super::{render, Vars};

    #[test]
    fn fills_known_variables_and_keeps_unknown_ones() {
        let vars = Vars {
            now: 1_789_000_000,
            last_run_at: None,
            title: "Triage",
            repo: "/code/trace/",
        };
        let out = render("{title} in {repo} since {lastRunAt} — {mystery}", &vars);
        assert_eq!(
            out,
            "Triage in trace since never (this is the first run) — {mystery}"
        );
        assert!(render("{date}", &vars).len() == 10);
    }
}
