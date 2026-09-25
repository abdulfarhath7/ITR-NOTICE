//! The unattended scheduler (task 12.4, Q09). At the configured IST time on
//! the configured days it starts a sweep of whatever is due by cadence,
//! exactly once per day, and only on the collector when a relay is
//! configured. The run itself is the ordinary attended runner: if the
//! portal does ask for a captcha or an OTP, the run pauses and the app
//! alerts — it never fails for want of a human.

use crate::error::AppResult;
use crate::repo::local;
use chrono::{Datelike, NaiveDate, NaiveTime, Timelike};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::Manager;

pub const KEY: &str = "sweep_schedule";
pub const KEY_LAST: &str = "sweep_schedule_last_date";

/// The scheduler settings KV (docs/17 §6.5), a superset of the Build 1
/// schedule. `time` was the start minute; it is read as
/// `run_window_start` so a stored schedule carries over unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Schedule {
    pub enabled: bool,
    /// `HH:MM`, Asia/Kolkata. When a scheduled run may start.
    #[serde(alias = "time")]
    pub run_window_start: String,
    /// `HH:MM`, Asia/Kolkata. A scheduled run checkpoints and stops here.
    #[serde(default = "d_window_end")]
    pub run_window_end: String,
    /// ISO weekdays, 1 = Monday … 7 = Sunday.
    pub days: Vec<u32>,
    /// `due` sweeps the modules whose cadence has elapsed; `all` sweeps every module.
    pub scope: String,
    /// New rows issued within this many days are indexed (§2.3).
    #[serde(default = "d_lookback")]
    pub lookback_days: u32,
    /// Days without anything issued before a client goes weekly; `None` = never.
    #[serde(default = "d_dormant_after")]
    pub dormant_after_days: Option<u32>,
    /// `weekly` | `fortnightly`.
    #[serde(default = "d_dormant_cadence")]
    pub dormant_cadence: String,
    /// ISO weekday dormant clients are swept on.
    #[serde(default = "d_dormant_weekday")]
    pub dormant_weekday: u32,
    #[serde(default = "d_timeout")]
    pub client_timeout_min: u32,
    /// `index` | `download` — documents during a sweep.
    #[serde(default = "d_docs_policy")]
    pub docs_policy: String,
    /// 0 = off; else download pending documents of open items due within this many days.
    #[serde(default = "d_warm")]
    pub warm_cache_days: u32,
    #[serde(default = "d_true")]
    pub auto_item_fetch: bool,
}

fn d_window_end() -> String { "06:00".into() }
fn d_lookback() -> u32 { 30 }
fn d_dormant_after() -> Option<u32> { Some(90) }
fn d_dormant_cadence() -> String { "weekly".into() }
fn d_dormant_weekday() -> u32 { 7 }
fn d_timeout() -> u32 { 3 }
fn d_docs_policy() -> String { "index".into() }
fn d_warm() -> u32 { 7 }
fn d_true() -> bool { true }

impl Default for Schedule {
    fn default() -> Self {
        Schedule {
            enabled: false, run_window_start: "01:00".into(), run_window_end: d_window_end(),
            days: vec![1, 2, 3, 4, 5, 6], scope: "due".into(), lookback_days: d_lookback(),
            dormant_after_days: d_dormant_after(), dormant_cadence: d_dormant_cadence(),
            dormant_weekday: d_dormant_weekday(), client_timeout_min: d_timeout(),
            docs_policy: d_docs_policy(), warm_cache_days: d_warm(), auto_item_fetch: true,
        }
    }
}

pub fn get(con: &Connection) -> AppResult<Schedule> {
    Ok(local::get(con, KEY)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn set(con: &Connection, s: &Schedule) -> AppResult<()> {
    use crate::error::AppError;
    for t in [&s.run_window_start, &s.run_window_end] {
        NaiveTime::parse_from_str(t, "%H:%M").map_err(|_| AppError::invalid("times must be HH:MM"))?;
    }
    if s.days.iter().any(|d| !(1..=7).contains(d)) || !(1..=7).contains(&s.dormant_weekday) {
        return Err(AppError::invalid("days are 1 (Monday) to 7 (Sunday)"));
    }
    if !(1..=3650).contains(&s.lookback_days) { return Err(AppError::invalid("look back is 1 to 3650 days")); }
    if !(1..=120).contains(&s.client_timeout_min) { return Err(AppError::invalid("the per-client timeout is 1 to 120 minutes")); }
    if !matches!(s.docs_policy.as_str(), "index" | "download") { return Err(AppError::invalid("documents policy is index or download")); }
    if !matches!(s.dormant_cadence.as_str(), "weekly" | "fortnightly") { return Err(AppError::invalid("dormant cadence is weekly or fortnightly")); }
    // Writing always stores the new names, which completes the `time` migration.
    local::set(con, KEY, &serde_json::to_string(s)?)
}

/// The IST instant a run that starts at `start` must stop by: the next
/// `run_window_end` after it (a 01:00–06:00 window started at 23:30 ends at
/// 06:00 the next morning).
pub fn window_end_after(s: &Schedule, start: chrono::NaiveDateTime) -> Option<chrono::NaiveDateTime> {
    let end = NaiveTime::parse_from_str(&s.run_window_end, "%H:%M").ok()?;
    let today = start.date().and_time(end);
    Some(if today > start { today } else { today + chrono::Duration::days(1) })
}

pub fn ist_now() -> chrono::NaiveDateTime {
    chrono::Utc::now().with_timezone(&chrono_tz::Asia::Kolkata).naive_local()
}

/// Is a run due at `now` (IST), given the date a scheduled run last
/// started? Due from the window start until the window end on a configured
/// day, so a laptop asleep at 01:00 still runs when it wakes inside the
/// window — once.
pub fn due_now(s: &Schedule, now: chrono::NaiveDateTime, last_date: Option<NaiveDate>) -> bool {
    if !s.enabled { return false; }
    let Ok(at) = NaiveTime::parse_from_str(&s.run_window_start, "%H:%M") else { return false; };
    if !s.days.contains(&now.weekday().number_from_monday()) { return false; }
    if last_date == Some(now.date()) { return false; }
    let started = now.time().hour() > at.hour() || (now.time().hour() == at.hour() && now.time().minute() >= at.minute());
    if !started { return false; }
    // A window that ends later the same day closes the day's chance; one
    // that wraps past midnight (or an end before the start) does not.
    match NaiveTime::parse_from_str(&s.run_window_end, "%H:%M") {
        Ok(end) if end > at => now.time() < end,
        _ => true,
    }
}

/// The background tick, started once at setup.
pub fn spawn(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tick: u64 = 0;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            tick += 1;
            let state = app.state::<crate::AppState>();
            // Every ten minutes: are we still a device of the firm? (Q16)
            if tick.is_multiple_of(10) {
                if let Ok(true) = crate::wipe::check(&state).await {
                    let _ = crate::wipe::perform(&state).await;
                    crate::commands::ingestion::notify(&app, "This device was removed from the firm",
                        "Its local book and keys have been deleted. Close and reopen the app.");
                    let _ = tauri::Emitter::emit(&app, "ingestion", serde_json::json!({"ev": "state"}));
                    continue;
                }
            }
            let decision = (|| -> AppResult<Option<String>> {
                let con = crate::commands::lock_db(&state)?;
                let s = get(&con)?;
                let now = ist_now();
                let last = local::get(&con, KEY_LAST)?.and_then(|d| NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok());
                if !due_now(&s, now, last) { return Ok(None); }
                if crate::ingest::state::snapshot(&state.ingestion.shared).running { return Ok(None); }
                // Under a relay only the collector sweeps the book.
                if crate::relay::config(&con)?.is_some() {
                    let me = local::device_id(&con)?;
                    if local::get(&con, crate::relay::KEY_COLLECTOR_ID)?.as_deref() != Some(me.as_str()) {
                        return Ok(None);
                    }
                }
                local::set(&con, KEY_LAST, &now.date().format("%Y-%m-%d").to_string())?;
                Ok(Some(s.scope))
            })();
            match decision {
                Ok(Some(scope)) => {
                    let all_now = scope == "all";
                    let result = crate::commands::ingestion::launch_sweep(app.clone(), &state, crate::repo::queue::Scope::All, all_now, None, true);
                    match result {
                        Ok(id) => crate::commands::ingestion::notify(&app, "Scheduled sweep started", &format!("sweep {}", &id[..8.min(id.len())])),
                        Err(e) => crate::commands::ingestion::notify(&app, "Scheduled sweep did not start", &e.to_string()),
                    }
                }
                Ok(None) => {}
                Err(e) => { let _ = e; }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(date: &str, time: &str) -> chrono::NaiveDateTime {
        chrono::NaiveDateTime::parse_from_str(&format!("{date} {time}"), "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn due_once_a_day_on_configured_days_from_the_configured_minute() {
        let s = Schedule { enabled: true, run_window_start: "02:00".into(), run_window_end: "23:59".into(),
                           days: vec![1, 2, 3, 4, 5], ..Schedule::default() };
        let monday = "2026-09-14";
        assert!(!due_now(&s, at(monday, "01:59"), None));
        assert!(due_now(&s, at(monday, "02:00"), None));
        assert!(due_now(&s, at(monday, "09:30"), None), "a laptop asleep at 02:00 runs when it wakes");
        assert!(!due_now(&s, at(monday, "09:30"), Some(NaiveDate::from_ymd_opt(2026, 9, 14).unwrap())), "once a day");
        assert!(!due_now(&s, at("2026-09-13", "10:00"), None), "Sunday is not configured");
        assert!(!due_now(&Schedule { enabled: false, ..s.clone() }, at(monday, "03:00"), None));
    }
}
