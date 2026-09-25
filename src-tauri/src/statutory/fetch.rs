//! Fetch, hash, diff (docs/19 §3): a plain HTTPS GET per calendar year, no
//! browser, no cookies, no credentials. Never deletes a row; never moves a
//! date without an event.

use crate::error::AppResult;
use crate::ids::now;
use crate::repo::model::StatutoryDeadline;
use crate::statutory::{parse, repo, rules};
use rusqlite::Connection;
use std::collections::HashMap;

pub const URL: &str = "https://incometaxindia.gov.in/Pages/yearly-deadlines.aspx?yfmv=";

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Outcome {
    pub year: i32,
    pub status: String,
    pub added: usize,
    pub extended: usize,
    pub removed: usize,
    pub unparsed: usize,
    pub rows: usize,
    pub error: Option<String>,
}

/// Apply one page's rows to the store (docs/19 §3.2). Pure over the
/// database: the tests feed the fixture straight in.
pub fn apply_page(con: &Connection, year: i32, html: &str) -> AppResult<Outcome> {
    let hash = parse::page_hash(html);
    let mut out = Outcome { year, ..Default::default() };
    if let Some(last) = repo::last_fetch(con, year)? {
        if last.page_hash.as_deref() == Some(hash.as_str()) && last.status != "failed" {
            repo::record_fetch(con, year, "unchanged", Some(&hash), last.rows, None)?;
            out.status = "unchanged".into();
            out.rows = last.rows.unwrap_or(0) as usize;
            return Ok(out);
        }
    }
    let parsed = parse::parse_page(html);
    let stored: HashMap<String, StatutoryDeadline> = repo::stored_for_year(con, year)?.into_iter().map(|d| (d.id.clone(), d)).collect();
    let ts = now();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for p in &parsed {
        seen.insert(p.id.clone());
        let category = rules::category_of(&p.title);
        let applies = serde_json::to_string(&rules::tags_of(&p.title, category))?;
        // The note may carry an extension; the date in force follows it.
        let ext = p.note.as_deref().and_then(parse::parse_extension);
        let (due_on, circular, unparsed) = match &ext {
            Some(e) => match e.to {
                Some(to) => (to.format("%Y-%m-%d").to_string(), e.circular.clone(), false),
                None => (p.source_on.format("%Y-%m-%d").to_string(), e.circular.clone(), true),
            },
            None => (p.source_on.format("%Y-%m-%d").to_string(), None, false),
        };
        match stored.get(&p.id) {
            None => {
                let d = StatutoryDeadline {
                    id: p.id.clone(), due_on: due_on.clone(),
                    original_on: (due_on != p.source_on.format("%Y-%m-%d").to_string()).then(|| p.source_on.format("%Y-%m-%d").to_string()),
                    title: p.title.clone(), category: category.into(), note: p.note.clone(), circular, applies,
                    source_year: year, first_seen_at: ts.clone(), last_seen_at: ts.clone(), removed_at: None,
                    created_at: ts.clone(), updated_at: ts.clone(),
                };
                repo::save_deadline(con, &d)?;
                repo::write_event(con, &d.id, "statutory_added", repo::event_payload(&d, None, Some(&d.due_on)))?;
                out.added += 1;
                if unparsed {
                    repo::write_event(con, &d.id, "statutory_unparsed", repo::event_payload(&d, None, None))?;
                    out.unparsed += 1;
                }
            }
            Some(old) => {
                let mut d = old.clone();
                d.last_seen_at = ts.clone();
                d.removed_at = None;
                let note_changed = d.note != p.note;
                if unparsed && note_changed {
                    // Blank beats guessed: keep the date, keep the note, say so.
                    d.note = p.note.clone();
                    d.updated_at = ts.clone();
                    repo::save_deadline(con, &d)?;
                    repo::write_event(con, &d.id, "statutory_unparsed", repo::event_payload(&d, None, None))?;
                    out.unparsed += 1;
                } else if d.due_on != due_on {
                    let from = d.due_on.clone();
                    d.original_on = Some(d.original_on.clone().unwrap_or(from.clone()));
                    d.due_on = due_on.clone();
                    d.note = p.note.clone();
                    d.circular = circular;
                    d.updated_at = ts.clone();
                    repo::save_deadline(con, &d)?;
                    repo::write_event(con, &d.id, "statutory_extended", repo::event_payload(&d, Some(&from), Some(&due_on)))?;
                    out.extended += 1;
                } else {
                    if note_changed { d.note = p.note.clone(); d.circular = circular; d.updated_at = ts.clone(); }
                    repo::save_deadline(con, &d)?;
                }
            }
        }
    }
    // Rows that left the page stay, marked.
    for (id, old) in &stored {
        if seen.contains(id) || old.removed_at.is_some() { continue; }
        let mut d = old.clone();
        d.removed_at = Some(ts.clone());
        d.updated_at = ts.clone();
        repo::save_deadline(con, &d)?;
        repo::write_event(con, &d.id, "statutory_removed", repo::event_payload(&d, Some(&d.due_on), None))?;
        out.removed += 1;
    }
    repo::record_fetch(con, year, "ok", Some(&hash), Some(parsed.len() as i64), None)?;
    out.status = "ok".into();
    out.rows = parsed.len();
    Ok(out)
}

/// GET one year's page. Plain client, browser-like headers, one try.
pub async fn get_page(year: i32) -> Result<String, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(45)).build().map_err(|e| e.to_string())?;
    let res = client.get(format!("{URL}{year}"))
        .header("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) LitigationCommandCenter/0.2")
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-IN,en;q=0.9")
        .send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(format!("the portal answered {status}")); }
    if body.contains("Access Denied") && body.len() < 2000 { return Err("the portal refused the request (access denied)".into()); }
    Ok(body)
}

/// docs/19 §3: fetch every year for today and apply each page. A failed
/// year writes a `failed` fetch row and leaves its rows alone.
pub async fn refresh(db: &std::sync::Arc<std::sync::Mutex<Connection>>, today: chrono::NaiveDate) -> AppResult<Vec<Outcome>> {
    let mut out = Vec::new();
    for year in crate::statutory::years_to_fetch(today) {
        match get_page(year).await {
            Ok(html) => {
                let con = db.lock().map_err(|e| crate::error::AppError::state(e.to_string()))?;
                out.push(apply_page(&con, year, &html)?);
            }
            Err(e) => {
                let con = db.lock().map_err(|e| crate::error::AppError::state(e.to_string()))?;
                repo::record_fetch(&con, year, "failed", None, None, Some(&e))?;
                out.push(Outcome { year, status: "failed".into(), error: Some(e), ..Default::default() });
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../../sidecar/tests/fixtures/statutory/yearly-deadlines-2026.html");

    fn db() -> Connection {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        con
    }

    fn count(con: &Connection, sql: &str) -> i64 { con.query_row(sql, [], |r| r.get(0)).unwrap() }

    /// docs/19 task 31.4 "done when".
    #[test]
    fn unchanged_page_writes_no_entries_and_an_edit_moves_the_date_once() {
        let con = db();
        let first = apply_page(&con, 2026, FIXTURE).unwrap();
        assert_eq!(first.status, "ok");
        assert_eq!(first.added as i64, count(&con, "SELECT count(*) FROM statutory_deadlines"));
        assert_eq!(first.unparsed, 1, "the vague November note is flagged, not guessed");
        // The July row carried an extension on first sight: due moved, original kept.
        let (due, orig, circ): (String, Option<String>, Option<String>) = con.query_row(
            "SELECT due_on, original_on, circular FROM statutory_deadlines WHERE title LIKE 'Return of income for the assessment year 2026-27 for all assessee other than%'",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((due.as_str(), orig.as_deref(), circ.as_deref()), ("2026-09-15", Some("2026-07-31"), Some("06/2026")));
        let events_after_first = count(&con, "SELECT count(*) FROM statutory_events");

        let again = apply_page(&con, 2026, FIXTURE).unwrap();
        assert_eq!(again.status, "unchanged");
        assert_eq!(count(&con, "SELECT count(*) FROM statutory_fetches WHERE status = 'unchanged'"), 1);
        assert_eq!(count(&con, "SELECT count(*) FROM statutory_events"), events_after_first, "no entries on an unchanged page");

        // Edit the fixture: the January 31 TDS statement gains an extension note.
        let edited = FIXTURE.replace(
            "<p class=\"desc\">Quarterly statement of TDS deposited for the quarter ending December 31, 2025.</p>",
            "<p class=\"desc\">Quarterly statement of TDS deposited for the quarter ending December 31, 2025.</p>\n<p class=\"note\">The due date has been extended from January 31, 2026 to February 15, 2026 vide Circular No. 02/2026.</p>");
        let third = apply_page(&con, 2026, &edited).unwrap();
        assert_eq!((third.status.as_str(), third.extended, third.added, third.removed), ("ok", 1, 0, 0));
        let (due, orig): (String, Option<String>) = con.query_row(
            "SELECT due_on, original_on FROM statutory_deadlines WHERE title = 'Quarterly statement of TDS deposited for the quarter ending December 31, 2025'",
            [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((due.as_str(), orig.as_deref()), ("2026-02-15", Some("2026-01-31")));
        assert_eq!(count(&con, "SELECT count(*) FROM statutory_events WHERE kind = 'statutory_extended'"), 1);

        // A row that leaves the page is marked, never deleted.
        let shorter = edited.replace("<h3 class=\"date\">Tuesday, December 15, 2026</h3>\n<p class=\"desc\">Third instalment of advance tax for the assessment year 2027-28.</p>\n", "");
        let fourth = apply_page(&con, 2026, &shorter).unwrap();
        assert_eq!(fourth.removed, 1);
        assert_eq!(count(&con, "SELECT count(*) FROM statutory_deadlines WHERE removed_at IS NOT NULL"), 1);
        assert_eq!(count(&con, "SELECT count(*) FROM statutory_deadlines"), first.added as i64, "never deleted");
    }
}
