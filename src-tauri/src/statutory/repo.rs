//! Reads and writes for the statutory tables (docs/19 §2.2, §9).

use crate::error::{AppError, AppResult};
use crate::ids::{new_id, now};
use crate::repo::model::{FirmDate, StatutoryDeadline, StatutoryEvent, StatutoryFetch};
use crate::repo::rows;
use crate::statutory::rules;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::{json, Value};

pub fn deadline_row(r: &Row) -> rusqlite::Result<StatutoryDeadline> {
    Ok(StatutoryDeadline {
        id: r.get("id")?, due_on: r.get("due_on")?, original_on: r.get("original_on")?, title: r.get("title")?,
        category: r.get("category")?, note: r.get("note")?, circular: r.get("circular")?, applies: r.get("applies")?,
        source_year: r.get("source_year")?, first_seen_at: r.get("first_seen_at")?, last_seen_at: r.get("last_seen_at")?,
        removed_at: r.get("removed_at")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn fetch_row(r: &Row) -> rusqlite::Result<StatutoryFetch> {
    Ok(StatutoryFetch {
        id: r.get("id")?, source_year: r.get("source_year")?, fetched_at: r.get("fetched_at")?, status: r.get("status")?,
        page_hash: r.get("page_hash")?, rows: r.get("rows")?, error: r.get("error")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn firm_date_row(r: &Row) -> rusqlite::Result<FirmDate> {
    Ok(FirmDate {
        id: r.get("id")?, due_on: r.get("due_on")?, title: r.get("title")?, category: r.get("category")?, note: r.get("note")?,
        created_by: r.get("created_by")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn stored_for_year(con: &Connection, year: i32) -> AppResult<Vec<StatutoryDeadline>> {
    let mut st = con.prepare("SELECT * FROM statutory_deadlines WHERE source_year = ?1")?;
    let rows = st.query_map([year], deadline_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn last_fetch(con: &Connection, year: i32) -> AppResult<Option<StatutoryFetch>> {
    Ok(con.query_row("SELECT * FROM statutory_fetches WHERE source_year = ?1 ORDER BY fetched_at DESC LIMIT 1", [year], fetch_row).optional()?)
}

pub fn latest_fetch(con: &Connection) -> AppResult<Option<StatutoryFetch>> {
    Ok(con.query_row("SELECT * FROM statutory_fetches ORDER BY fetched_at DESC LIMIT 1", [], fetch_row).optional()?)
}

/// The IST date of the last fetch attempt of any year.
pub fn last_fetch_date(con: &Connection) -> AppResult<Option<chrono::NaiveDate>> {
    Ok(latest_fetch(con)?.and_then(|f| chrono::DateTime::parse_from_rfc3339(&f.fetched_at).ok())
        .map(|t| t.with_timezone(&chrono_tz::Asia::Kolkata).date_naive()))
}

pub fn record_fetch(con: &Connection, year: i32, status: &str, page_hash: Option<&str>, rows: Option<i64>, error: Option<&str>) -> AppResult<StatutoryFetch> {
    let ts = now();
    let f = StatutoryFetch {
        id: new_id(), source_year: year, fetched_at: ts.clone(), status: status.into(), page_hash: page_hash.map(str::to_string),
        rows, error: error.map(crate::mask::text), created_at: ts.clone(), updated_at: ts,
    };
    rows::upsert(con, "statutory_fetches", &f)?;
    Ok(f)
}

pub fn save_deadline(con: &Connection, d: &StatutoryDeadline) -> AppResult<()> {
    rows::upsert(con, "statutory_deadlines", d)
}

pub fn write_event(con: &Connection, deadline_id: &str, kind: &str, payload: Value) -> AppResult<()> {
    let ts = now();
    let e = StatutoryEvent { id: new_id(), deadline_id: deadline_id.into(), kind: kind.into(), payload: payload.to_string(),
                             at: ts.clone(), created_at: ts.clone(), updated_at: ts };
    rows::upsert(con, "statutory_events", &e)
}

// --------------------------------------------------------------- listing

/// What the screens draw (docs/19 §9 `list_statutory`).
#[derive(Debug, Clone, Serialize)]
pub struct StatutoryItem {
    pub id: String,
    pub due_on: String,
    pub original_on: Option<String>,
    pub title: String,
    pub category: String,
    pub category_label: String,
    pub note: Option<String>,
    pub circular: Option<String>,
    pub applies: Vec<String>,
    /// Enabled clients the row applies to; only computed for scope `applies`.
    pub applies_count: Option<i64>,
    /// `statutory` or `firm`.
    pub layer: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StatutoryStatus {
    pub last_fetched_at: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    /// The newest successful fetch, when the latest attempt failed.
    pub last_ok_at: Option<String>,
    pub deadlines: i64,
    pub years: Vec<i32>,
    pub next_due: String,
}

pub fn status(con: &Connection, next_due: &str) -> AppResult<StatutoryStatus> {
    let latest = latest_fetch(con)?;
    let last_ok: Option<String> = con.query_row(
        "SELECT fetched_at FROM statutory_fetches WHERE status IN ('ok','unchanged') ORDER BY fetched_at DESC LIMIT 1", [], |r| r.get(0)).optional()?;
    let deadlines: i64 = con.query_row("SELECT count(*) FROM statutory_deadlines WHERE removed_at IS NULL", [], |r| r.get(0))?;
    let mut st = con.prepare("SELECT DISTINCT source_year FROM statutory_deadlines ORDER BY source_year")?;
    let years: Vec<i32> = st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(StatutoryStatus {
        last_fetched_at: latest.as_ref().map(|f| f.fetched_at.clone()),
        last_status: latest.as_ref().map(|f| f.status.clone()),
        last_error: latest.and_then(|f| f.error),
        last_ok_at: last_ok, deadlines, years, next_due: next_due.into(),
    })
}

/// (entity_kind, audit_case, tp_case, tds_deductor) of one enabled client.
type ProfileRow = (Option<String>, bool, bool, bool);

fn profiles(con: &Connection) -> AppResult<Vec<ProfileRow>> {
    let mut st = con.prepare("SELECT entity_kind, audit_case, tp_case, tds_deductor FROM clients WHERE sync_enabled = 1")?;
    let rows = st.query_map([], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1, r.get::<_, i64>(2)? == 1, r.get::<_, i64>(3)? == 1)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Rows in force between two dates (inclusive), statutory then firm,
/// in date order. Scope `applies` keeps rows at least one enabled client
/// matches and fills `applies_count`; `overdue` keeps rows before `today`.
pub fn list(con: &Connection, from: &str, to: &str, scope: &str, today: &str) -> AppResult<Vec<StatutoryItem>> {
    let mut out = Vec::new();
    let profs = if scope == "applies" { Some(profiles(con)?) } else { None };
    let mut st = con.prepare(
        "SELECT * FROM statutory_deadlines WHERE removed_at IS NULL AND due_on >= ?1 AND due_on <= ?2 ORDER BY due_on, title")?;
    for d in st.query_map(params![from, to], deadline_row)? {
        let d = d?;
        if scope == "overdue" && d.due_on.as_str() >= today { continue; }
        let tags: Vec<String> = serde_json::from_str(&d.applies).unwrap_or_default();
        let applies_count = profs.as_ref().map(|ps| ps.iter().filter(|(ek, a, t, td)| rules::applies_to(&tags, &rules::Profile {
            entity_kind: ek.as_deref(), audit_case: *a, tp_case: *t, tds_deductor: *td })).count() as i64);
        if scope == "applies" && applies_count == Some(0) { continue; }
        out.push(StatutoryItem {
            id: d.id, due_on: d.due_on, original_on: d.original_on, category_label: rules::category_label(&d.category).into(),
            title: d.title, category: d.category, note: d.note, circular: d.circular, applies: tags, applies_count, layer: "statutory".into(),
        });
    }
    let mut st = con.prepare("SELECT * FROM firm_dates WHERE due_on >= ?1 AND due_on <= ?2 ORDER BY due_on, title")?;
    for f in st.query_map(params![from, to], firm_date_row)? {
        let f = f?;
        if scope == "overdue" && f.due_on.as_str() >= today { continue; }
        out.push(StatutoryItem {
            id: f.id, due_on: f.due_on, original_on: None, title: f.title, category: f.category.clone(),
            category_label: rules::category_label(&f.category).into(), note: f.note, circular: None, applies: vec!["everyone".into()],
            applies_count: profs.as_ref().map(|p| p.len() as i64), layer: "firm".into(),
        });
    }
    out.sort_by(|a, b| a.due_on.cmp(&b.due_on).then_with(|| a.title.cmp(&b.title)));
    Ok(out)
}

// ------------------------------------------------------------ firm dates

pub fn list_firm_dates(con: &Connection) -> AppResult<Vec<FirmDate>> {
    let mut st = con.prepare("SELECT * FROM firm_dates ORDER BY due_on, title")?;
    let rows = st.query_map([], firm_date_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn upsert_firm_date(con: &Connection, id: Option<&str>, due_on: &str, title: &str, note: Option<&str>, created_by: Option<&str>) -> AppResult<FirmDate> {
    chrono::NaiveDate::parse_from_str(due_on, "%Y-%m-%d").map_err(|_| AppError::invalid("enter the date as YYYY-MM-DD"))?;
    let title = title.trim();
    if title.is_empty() { return Err(AppError::invalid("give the date a title")); }
    let ts = now();
    let existing = match id {
        Some(id) => con.query_row("SELECT * FROM firm_dates WHERE id = ?1", [id], firm_date_row).optional()?,
        None => None,
    };
    let f = match existing {
        Some(e) => FirmDate { due_on: due_on.into(), title: title.into(), note: note.map(str::to_string).filter(|n| !n.trim().is_empty()),
                              updated_at: ts, ..e },
        None => FirmDate { id: new_id(), due_on: due_on.into(), title: title.into(), category: "firm".into(),
                           note: note.map(str::to_string).filter(|n| !n.trim().is_empty()), created_by: created_by.map(str::to_string),
                           created_at: ts.clone(), updated_at: ts },
    };
    rows::upsert(con, "firm_dates", &f)?;
    Ok(f)
}

pub fn delete_firm_date(con: &Connection, id: &str) -> AppResult<()> {
    rows::delete_with(con, "firm_dates", id, rows::Origin::Local)
}

// ------------------------------------------------------------------ ics

/// docs/19 §7: the statutory and firm layers of one FY as all-day events.
pub fn ics(con: &Connection, fy_start_year: i32) -> AppResult<String> {
    let from = format!("{fy_start_year}-04-01");
    let to = format!("{}-03-31", fy_start_year + 1);
    let items = list(con, &from, &to, "all", "0000-00-00")?;
    let esc = |s: &str| s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace('\n', "\\n");
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut out = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Litigation Command Center//Statutory calendar//EN\r\nCALSCALE:GREGORIAN\r\n");
    for i in &items {
        let day = i.due_on.replace('-', "");
        let next = chrono::NaiveDate::parse_from_str(&i.due_on, "%Y-%m-%d").map(|d| (d + chrono::Duration::days(1)).format("%Y%m%d").to_string())
            .unwrap_or_else(|_| day.clone());
        let mut desc = i.note.clone().unwrap_or_default();
        if let Some(c) = &i.circular { if !desc.is_empty() { desc.push(' '); } desc.push_str(&format!("Circular {c}")); }
        out.push_str("BEGIN:VEVENT\r\n");
        out.push_str(&format!("UID:{}@lcc\r\nDTSTAMP:{stamp}\r\nDTSTART;VALUE=DATE:{day}\r\nDTEND;VALUE=DATE:{next}\r\n", i.id));
        out.push_str(&format!("SUMMARY:{}\r\n", esc(&i.title)));
        if !desc.is_empty() { out.push_str(&format!("DESCRIPTION:{}\r\n", esc(&desc))); }
        out.push_str(&format!("CATEGORIES:{}\r\nEND:VEVENT\r\n", esc(&i.category_label)));
    }
    out.push_str("END:VCALENDAR\r\n");
    Ok(out)
}

pub fn event_payload(d: &StatutoryDeadline, from: Option<&str>, to: Option<&str>) -> Value {
    json!({ "title": d.title, "from": from, "to": to, "circular": d.circular, "note": d.note, "category": d.category })
}
