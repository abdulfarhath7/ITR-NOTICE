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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Schedule {
    pub enabled: bool,
    /// `HH:MM`, Asia/Kolkata.
    pub time: String,
    /// ISO weekdays, 1 = Monday … 7 = Sunday.
    pub days: Vec<u32>,
    /// `due` sweeps the modules whose cadence has elapsed; `all` sweeps every module.
    pub scope: String,
}

impl Default for Schedule {
    fn default() -> Self {
        Schedule { enabled: false, time: "02:00".into(), days: vec![1, 2, 3, 4, 5, 6], scope: "due".into() }
    }
}

pub fn get(con: &Connection) -> AppResult<Schedule> {
    Ok(local::get(con, KEY)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn set(con: &Connection, s: &Schedule) -> AppResult<()> {
    NaiveTime::parse_from_str(&s.time, "%H:%M").map_err(|_| crate::error::AppError::invalid("time must be HH:MM"))?;
    if s.days.iter().any(|d| !(1..=7).contains(d)) {
        return Err(crate::error::AppError::invalid("days are 1 (Monday) to 7 (Sunday)"));
    }
    local::set(con, KEY, &serde_json::to_string(s)?)
}

/// Is a run due at `now` (IST), given the date a scheduled run last
/// started? Due for the whole minute of the configured time and at any
/// later minute that day, so a laptop asleep at 02:00 still runs at 09:00
/// — once.
pub fn due_now(s: &Schedule, now: chrono::NaiveDateTime, last_date: Option<NaiveDate>) -> bool {
    if !s.enabled { return false; }
    let Ok(at) = NaiveTime::parse_from_str(&s.time, "%H:%M") else { return false; };
    if !s.days.contains(&now.weekday().number_from_monday()) { return false; }
    if last_date == Some(now.date()) { return false; }
    now.time().hour() > at.hour() || (now.time().hour() == at.hour() && now.time().minute() >= at.minute())
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
                let now = chrono::Utc::now().with_timezone(&chrono_tz::Asia::Kolkata).naive_local();
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
                    let result = crate::commands::ingestion::launch_scope(app.clone(), &state, crate::repo::queue::Scope::All, all_now);
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
        let s = Schedule { enabled: true, time: "02:00".into(), days: vec![1, 2, 3, 4, 5], scope: "due".into() };
        let monday = "2026-09-14";
        assert!(!due_now(&s, at(monday, "01:59"), None));
        assert!(due_now(&s, at(monday, "02:00"), None));
        assert!(due_now(&s, at(monday, "09:30"), None), "a laptop asleep at 02:00 runs when it wakes");
        assert!(!due_now(&s, at(monday, "09:30"), Some(NaiveDate::from_ymd_opt(2026, 9, 14).unwrap())), "once a day");
        assert!(!due_now(&s, at("2026-09-13", "10:00"), None), "Sunday is not configured");
        assert!(!due_now(&Schedule { enabled: false, ..s.clone() }, at(monday, "03:00"), None));
    }
}
