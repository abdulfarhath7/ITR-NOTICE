//! Dates are stored as `YYYY-MM-DD` text and compared in Asia/Kolkata.
//! The portal writes `17-Aug-2026`; earlier code also met `17/08/2026`. A
//! numeric form is always day-first — `03/09/2026` is 3 September, and the
//! test below uses a day above 12 so an MM/DD reading cannot pass.

use chrono::{Datelike, NaiveDate, Utc};
use chrono_tz::Asia::Kolkata;

const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun",
                            "jul", "aug", "sep", "oct", "nov", "dec"];

/// Parse a portal date into ISO. `None` for blank, `-`, `Not Available`, or
/// anything that does not look like a date — the caller records a gap, it
/// never guesses.
pub fn parse_portal_date(text: &str) -> Option<NaiveDate> {
    let raw = text.trim();
    if raw.is_empty() || raw == "-" || raw.eq_ignore_ascii_case("not available") {
        return None;
    }
    // Already ISO.
    if let Ok(d) = NaiveDate::parse_from_str(raw, "%Y-%m-%d") {
        return Some(d);
    }
    // 17-Aug-2026, 17 Aug 2026, 17/Aug/2026, 17-August-2026
    let parts: Vec<&str> = raw.split(['-', '/', ' ']).filter(|p| !p.is_empty()).collect();
    if parts.len() == 3 {
        let day: Option<u32> = parts[0].parse().ok();
        let year: Option<i32> = parts[2].parse().ok();
        if let (Some(day), Some(year)) = (day, year) {
            let month = if let Ok(m) = parts[1].parse::<u32>() {
                Some(m)
            } else {
                let key = parts[1].to_ascii_lowercase();
                MONTHS.iter().position(|m| key.starts_with(m)).map(|i| i as u32 + 1)
            };
            if let Some(month) = month {
                if (1..=12).contains(&month) && year >= 1900 {
                    return NaiveDate::from_ymd_opt(year, month, day);
                }
            }
        }
    }
    None
}

/// ISO text or `None`; the shape every date column stores.
pub fn to_iso(text: Option<&str>) -> Option<String> {
    text.and_then(parse_portal_date).map(|d| d.format("%Y-%m-%d").to_string())
}

/// Today in Asia/Kolkata. Computing in UTC is off by one every evening after
/// 17:30 UTC, which is the whole working day in India.
pub fn today_ist() -> NaiveDate {
    Utc::now().with_timezone(&Kolkata).date_naive()
}

/// Whole days from `today` to `date`; negative means past. Callers must
/// render this through `due::describe`, never print it raw (docs/15).
pub fn days_until(date: NaiveDate, today: NaiveDate) -> i64 {
    (date - today).num_days()
}

/// `22 Sep` or `22 Sep 2025` when the year differs from today's.
pub fn short_date(date: NaiveDate, today: NaiveDate) -> String {
    if date.year() == today.year() {
        date.format("%-d %b").to_string()
    } else {
        date.format("%-d %b %Y").to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// docs/12: a day above 12 catches DD/MM versus MM/DD inversion.
    #[test]
    fn day_first_numeric_dates_with_day_above_twelve() {
        assert_eq!(parse_portal_date("25/09/2026"), NaiveDate::from_ymd_opt(2026, 9, 25));
        assert_eq!(parse_portal_date("25-09-2026"), NaiveDate::from_ymd_opt(2026, 9, 25));
        // and the ambiguous one still reads day-first
        assert_eq!(parse_portal_date("03/09/2026"), NaiveDate::from_ymd_opt(2026, 9, 3));
    }

    #[test]
    fn portal_month_name_form() {
        assert_eq!(parse_portal_date("17-Aug-2026"), NaiveDate::from_ymd_opt(2026, 8, 17));
        assert_eq!(parse_portal_date("2-Sep-2026"), NaiveDate::from_ymd_opt(2026, 9, 2));
        assert_eq!(parse_portal_date("17 August 2026"), NaiveDate::from_ymd_opt(2026, 8, 17));
        assert_eq!(to_iso(Some("17-Aug-2026")).as_deref(), Some("2026-08-17"));
    }

    #[test]
    fn blanks_and_junk_are_none_not_today() {
        for junk in ["", " ", "-", "Not Available", "soon", "32/01/2026", "17-Foo-2026"] {
            assert_eq!(parse_portal_date(junk), None, "{junk:?}");
        }
    }

    /// docs/12: day arithmetic across the IST boundary after 17:30 UTC.
    #[test]
    fn ist_day_boundary() {
        use chrono::TimeZone;
        // 2026-09-12 19:00 UTC is already 2026-09-13 in Kolkata (UTC+5:30).
        let utc = Utc.with_ymd_and_hms(2026, 9, 12, 19, 0, 0).unwrap();
        let ist_day = utc.with_timezone(&Kolkata).date_naive();
        assert_eq!(ist_day, NaiveDate::from_ymd_opt(2026, 9, 13).unwrap());
        let due = NaiveDate::from_ymd_opt(2026, 9, 13).unwrap();
        assert_eq!(days_until(due, ist_day), 0);
        assert_eq!(days_until(due, utc.date_naive()), 1);
    }
}
