//! Clients and their year contexts.

use crate::error::AppResult;
use crate::ids::{new_id, now};
use crate::repo::model::{Client, YearContext};
use crate::repo::rows;
use rusqlite::{params, Connection, OptionalExtension, Row};

pub fn from_row(r: &Row) -> rusqlite::Result<Client> {
    Ok(Client {
        id: r.get("id")?, client_code: r.get("client_code")?, name: r.get("name")?,
        pan: r.get("pan")?, gstin: r.get("gstin")?, entity_type: r.get("entity_type")?,
        client_group: r.get("client_group")?, phone_cc: r.get("phone_cc")?, phone: r.get("phone")?,
        email: r.get("email")?, portal_login_ref: r.get("portal_login_ref")?, source: r.get("source")?,
        client_file_no: r.get("client_file_no")?, tags: r.get("tags")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
        // Tolerant: read before 0019/0020 exist (the legacy backfill).
        sync_enabled: r.get("sync_enabled").unwrap_or(None),
        note: r.get("note").unwrap_or(None),
        history_depth: r.get("history_depth").unwrap_or(None),
        history_fetched_at: r.get("history_fetched_at").unwrap_or(None),
        history_note: r.get("history_note").unwrap_or(None),
        cadence_tier: r.get("cadence_tier").unwrap_or(None),
        cadence_pinned: r.get("cadence_pinned").unwrap_or(None),
        last_swept_at: r.get("last_swept_at").unwrap_or(None),
        sync_pause_reason: r.get("sync_pause_reason").unwrap_or(None),
        entity_kind: r.get("entity_kind").unwrap_or(None),
        audit_case: r.get("audit_case").unwrap_or(None),
        tp_case: r.get("tp_case").unwrap_or(None),
        tds_deductor: r.get("tds_deductor").unwrap_or(None),
    })
}

pub fn get(con: &Connection, id: &str) -> AppResult<Option<Client>> {
    Ok(con.query_row("SELECT * FROM clients WHERE id = ?1", [id], from_row).optional()?)
}

pub fn find_by_pan(con: &Connection, pan: &str) -> AppResult<Option<Client>> {
    Ok(con.query_row("SELECT * FROM clients WHERE pan = ?1", [pan.trim().to_ascii_uppercase()], from_row)
        .optional()?)
}

pub fn list(con: &Connection) -> AppResult<Vec<Client>> {
    let mut st = con.prepare("SELECT * FROM clients ORDER BY name COLLATE NOCASE")?;
    let rows = st.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The holder type is the fourth character of a PAN. Derivation, not a
/// guess; anything unrecognised is `other`.
pub fn entity_type_from_pan(pan: &str) -> &'static str {
    match pan.as_bytes().get(3).map(|b| b.to_ascii_uppercase()) {
        Some(b'P') => "individual",
        Some(b'C') => "company",
        Some(b'F') => "firm",
        Some(b'H') => "huf",
        Some(b'T') => "trust",
        Some(b'A') => "aop",
        _ => "other",
    }
}

/// Create the minimal client a sweep can vouch for: a PAN and a name.
pub fn create_minimal(con: &Connection, pan: &str, name: Option<&str>) -> AppResult<Client> {
    let pan = pan.trim().to_ascii_uppercase();
    let ts = now();
    let c = Client {
        sync_enabled: None, note: None, history_depth: None, history_fetched_at: None, history_note: None,
        cadence_tier: None, cadence_pinned: None, last_swept_at: None, sync_pause_reason: None,
        entity_kind: None, audit_case: None, tp_case: None, tds_deductor: None,
        id: new_id(),
        client_code: None,
        name: name.map(str::trim).filter(|n| !n.is_empty()).unwrap_or(&pan).to_string(),
        entity_type: entity_type_from_pan(&pan).to_string(),
        pan,
        gstin: None, client_group: None, phone_cc: "+91".into(), phone: None, email: None,
        portal_login_ref: None, source: "portal".into(), client_file_no: None, tags: None,
        created_at: ts.clone(), updated_at: ts,
    };
    rows::upsert(con, "clients", &c)?;
    Ok(c)
}

pub fn save(con: &Connection, client: &Client) -> AppResult<()> {
    rows::upsert(con, "clients", client)
}

pub fn year_context_row(r: &Row) -> rusqlite::Result<YearContext> {
    Ok(YearContext {
        id: r.get("id")?, client_id: r.get("client_id")?,
        assessment_year: r.get("assessment_year")?, financial_year: r.get("financial_year")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn year_contexts(con: &Connection, client_id: &str) -> AppResult<Vec<YearContext>> {
    let mut st = con.prepare(
        "SELECT * FROM year_contexts WHERE client_id = ?1
         ORDER BY assessment_year IS NULL, assessment_year DESC")?;
    let rows = st.query_map([client_id], year_context_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// `AY 2024-25` reads `FY 2023-24`. Only used to fill financial_year when
/// the portal showed the AY but not the FY; it is arithmetic, not a guess.
pub fn financial_year_for(ay: &str) -> Option<String> {
    let (start, _) = ay.split_once('-')?;
    let y: i32 = start.parse().ok()?;
    Some(format!("{}-{:02}", y - 1, y % 100))
}

/// Find or create the year context. `assessment_year = None` is the one
/// "not stated" context per client (D-007).
pub fn ensure_year_context(con: &Connection, client_id: &str, assessment_year: Option<&str>,
                           financial_year: Option<&str>) -> AppResult<YearContext> {
    let ay = assessment_year.map(str::trim).filter(|s| !s.is_empty());
    let existing = con.query_row(
        "SELECT * FROM year_contexts WHERE client_id = ?1 AND assessment_year IS ?2",
        params![client_id, ay], year_context_row).optional()?;
    if let Some(yc) = existing {
        return Ok(yc);
    }
    let ts = now();
    let yc = YearContext {
        id: new_id(),
        client_id: client_id.to_string(),
        assessment_year: ay.map(str::to_string),
        financial_year: financial_year.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
            .or_else(|| ay.and_then(financial_year_for)),
        created_at: ts.clone(), updated_at: ts,
    };
    rows::upsert(con, "year_contexts", &yc)?;
    Ok(yc)
}
