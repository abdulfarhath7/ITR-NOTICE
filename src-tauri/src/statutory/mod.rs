//! The statutory calendar (docs/19): the public Income Tax Department tax
//! calendar fetched without a login, firm dates, and the settings that
//! shape the Calendar screen. `parse` reads the page, `rules` classifies
//! rows, `fetch` diffs and stores, `repo` reads for the screens.

pub mod fetch;
pub mod parse;
pub mod repo;
pub mod rules;

use crate::error::{AppError, AppResult};
use crate::repo::local;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub const KEY_SETTINGS: &str = "calendar_settings";

/// Settings → Calendar (docs/19 §8), one KV object.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CalendarSettings {
    /// `weekly` | `nightly` (Q65)
    #[serde(default = "d_weekly")]
    pub refresh: String,
    /// `monday` | `sunday` (Q63)
    #[serde(default = "d_monday")]
    pub first_day: String,
    /// `all` | `applies` | `overdue`
    #[serde(default = "d_all")]
    pub default_scope: String,
    #[serde(default = "d_true")]
    pub sidebar_mini: bool,
}
fn d_weekly() -> String { "weekly".into() }
fn d_monday() -> String { "monday".into() }
fn d_all() -> String { "all".into() }
fn d_true() -> bool { true }

impl Default for CalendarSettings {
    fn default() -> Self {
        CalendarSettings { refresh: d_weekly(), first_day: d_monday(), default_scope: d_all(), sidebar_mini: true }
    }
}

pub fn settings(con: &Connection) -> AppResult<CalendarSettings> {
    Ok(local::get(con, KEY_SETTINGS)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn set_settings(con: &Connection, s: &CalendarSettings) -> AppResult<()> {
    if !matches!(s.refresh.as_str(), "weekly" | "nightly") { return Err(AppError::invalid("refresh is weekly or nightly")); }
    if !matches!(s.first_day.as_str(), "monday" | "sunday") { return Err(AppError::invalid("first day is monday or sunday")); }
    if !matches!(s.default_scope.as_str(), "all" | "applies" | "overdue") { return Err(AppError::invalid("scope is all, applies or overdue")); }
    local::set(con, KEY_SETTINGS, &serde_json::to_string(s)?)
}

/// The Indian financial year that holds `d`: 1 Apr – 31 Mar.
pub fn fy_start_year(d: chrono::NaiveDate) -> i32 {
    use chrono::Datelike;
    if d.month() >= 4 { d.year() } else { d.year() - 1 }
}

/// docs/19 §2.1: the calendar years to fetch for today — the current FY's
/// two years, plus the next FY's second year once the date is past 1 Jan.
pub fn years_to_fetch(today: chrono::NaiveDate) -> Vec<i32> {
    use chrono::Datelike;
    let y = fy_start_year(today);
    let mut out = vec![y, y + 1];
    if today.month() < 4 || today.year() > y { out.push(y + 2); }
    out.sort();
    out.dedup();
    out
}

/// docs/19 §3.1: weekly on the run window's first enabled day, nightly in
/// the seven days either side of the FY boundary; `nightly` overrides.
pub fn fetch_due(con: &Connection, today: chrono::NaiveDate, first_enabled_weekday: Option<u32>) -> AppResult<bool> {
    use chrono::Datelike;
    let s = settings(con)?;
    let last = repo::last_fetch_date(con)?;
    if last == Some(today) { return Ok(false); }
    if s.refresh == "nightly" { return Ok(true); }
    let boundary = chrono::NaiveDate::from_ymd_opt(if today.month() >= 4 { today.year() + 1 } else { today.year() }, 4, 1).unwrap();
    let near = (boundary - today).num_days().abs() <= 7
        || (today - chrono::NaiveDate::from_ymd_opt(fy_start_year(today), 4, 1).unwrap()).num_days().abs() <= 7;
    if near { return Ok(true); }
    let weekday = first_enabled_weekday.unwrap_or(1);
    if today.weekday().number_from_monday() == weekday { return Ok(true); }
    // Never fetched at all, or more than a week stale: catch up.
    Ok(last.map(|d| (today - d).num_days() >= 7).unwrap_or(true))
}
