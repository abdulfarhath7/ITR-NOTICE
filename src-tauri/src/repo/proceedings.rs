//! Proceedings, communications, responses and adjournment requests.

use crate::error::AppResult;
use crate::repo::model::{AdjournmentRequest, Communication, Proceeding, Response};
use crate::repo::rows;
use rusqlite::{Connection, OptionalExtension, Row};

pub fn from_row(r: &Row) -> rusqlite::Result<Proceeding> {
    Ok(Proceeding {
        id: r.get("id")?, year_context_id: r.get("year_context_id")?,
        proceeding_type_id: r.get("proceeding_type_id")?, natural_key: r.get("natural_key")?,
        display_name: r.get("display_name")?, assessee_name: r.get("assessee_name")?,
        section_2025: r.get("section_2025")?, section_1961: r.get("section_1961")?,
        din_reference: r.get("din_reference")?, authority: r.get("authority")?,
        initiated_on: r.get("initiated_on")?, due_date: r.get("due_date")?,
        manual_due_date: r.get("manual_due_date")?, suggested_due_date: r.get("suggested_due_date")?,
        limitation_date: r.get("limitation_date")?, hearing_date: r.get("hearing_date")?,
        status: r.get("status")?, portal_status: r.get("portal_status")?,
        closure_date: r.get("closure_date")?, closure_order: r.get("closure_order")?,
        source_panel: r.get("source_panel")?, created_mode: r.get("created_mode")?,
        appeal_number: r.get("appeal_number")?, order_appealed_against: r.get("order_appealed_against")?,
        verified_flag: r.get("verified_flag")?, gap_flags: r.get("gap_flags")?,
        row_hash: r.get("row_hash")?, first_seen_at: r.get("first_seen_at")?,
        last_seen_at: r.get("last_seen_at")?, created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

pub fn communication_row(r: &Row) -> rusqlite::Result<Communication> {
    Ok(Communication {
        id: r.get("id")?, proceeding_id: r.get("proceeding_id")?,
        communication_type_id: r.get("communication_type_id")?, reference_id: r.get("reference_id")?,
        din: r.get("din")?, section_2025: r.get("section_2025")?, section_1961: r.get("section_1961")?,
        description: r.get("description")?, issued_on: r.get("issued_on")?, served_on: r.get("served_on")?,
        response_due_date: r.get("response_due_date")?, ao_viewed_on: r.get("ao_viewed_on")?,
        ao_viewed_first_seen_at: r.get("ao_viewed_first_seen_at").unwrap_or(None),
        status: r.get("status")?, direction: r.get("direction")?, verified_flag: r.get("verified_flag")?,
        gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?,
        first_seen_at: r.get("first_seen_at")?, last_seen_at: r.get("last_seen_at")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn response_row(r: &Row) -> rusqlite::Result<Response> {
    Ok(Response {
        id: r.get("id")?, proceeding_id: r.get("proceeding_id")?, in_reply_to: r.get("in_reply_to")?,
        response_mode: r.get("response_mode")?, filed_on: r.get("filed_on")?, filed_by: r.get("filed_by")?,
        remarks: r.get("remarks")?, transaction_id: r.get("transaction_id")?, direction: r.get("direction")?,
        verified_flag: r.get("verified_flag")?, gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn adjournment_row(r: &Row) -> rusqlite::Result<AdjournmentRequest> {
    Ok(AdjournmentRequest {
        id: r.get("id")?, proceeding_id: r.get("proceeding_id")?, sought_date: r.get("sought_date")?,
        reason: r.get("reason")?, outcome: r.get("outcome")?, filed_on: r.get("filed_on")?,
        verified_flag: r.get("verified_flag")?, gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn get(con: &Connection, id: &str) -> AppResult<Option<Proceeding>> {
    Ok(con.query_row("SELECT * FROM proceedings WHERE id = ?1", [id], from_row).optional()?)
}

pub fn by_natural_key(con: &Connection, key: &str) -> AppResult<Option<Proceeding>> {
    Ok(con.query_row("SELECT * FROM proceedings WHERE natural_key = ?1", [key], from_row).optional()?)
}

pub fn save(con: &Connection, p: &Proceeding) -> AppResult<()> {
    rows::upsert(con, "proceedings", p)
}

pub fn communication_by_reference(con: &Connection, reference_id: &str) -> AppResult<Option<Communication>> {
    Ok(con.query_row("SELECT * FROM communications WHERE reference_id = ?1", [reference_id],
                     communication_row).optional()?)
}

pub fn communications_for(con: &Connection, proceeding_id: &str) -> AppResult<Vec<Communication>> {
    let mut st = con.prepare(
        "SELECT * FROM communications WHERE proceeding_id = ?1 ORDER BY issued_on IS NULL, issued_on, created_at")?;
    let rows = st.query_map([proceeding_id], communication_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_communication(con: &Connection, c: &Communication) -> AppResult<()> {
    rows::upsert(con, "communications", c)
}

pub fn responses_for(con: &Connection, proceeding_id: &str) -> AppResult<Vec<Response>> {
    let mut st = con.prepare(
        "SELECT * FROM responses WHERE proceeding_id = ?1 ORDER BY filed_on IS NULL, filed_on, created_at")?;
    let rows = st.query_map([proceeding_id], response_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_response(con: &Connection, r: &Response) -> AppResult<()> {
    rows::upsert(con, "responses", r)
}

pub fn adjournments_for(con: &Connection, proceeding_id: &str) -> AppResult<Vec<AdjournmentRequest>> {
    let mut st = con.prepare(
        "SELECT * FROM adjournment_requests WHERE proceeding_id = ?1 ORDER BY filed_on IS NULL, filed_on")?;
    let rows = st.query_map([proceeding_id], adjournment_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The proceeding's `due_date` is the portal-stated response due date of its
/// earliest still-open communication. The portal shows the date on the
/// notice card, not the proceeding card, so this is a roll-up of a stated
/// value, never a computed one. `None` when no open communication states one.
pub fn refresh_due_date(con: &Connection, proceeding_id: &str) -> AppResult<()> {
    let Some(mut p) = get(con, proceeding_id)? else { return Ok(()); };
    let rolled: Option<String> = con.query_row(
        "SELECT response_due_date FROM communications
         WHERE proceeding_id = ?1 AND response_due_date IS NOT NULL
           AND status IN ('open', 'adjournment_sought', 'unknown')
         ORDER BY response_due_date LIMIT 1",
        [proceeding_id], |r| r.get(0)).optional()?;
    if p.due_date != rolled {
        p.due_date = rolled;
        p.gap_flags = Some(with_gap(p.gap_flags.as_deref(), "due_date", p.due_date.is_none()));
        p.updated_at = crate::ids::now();
        save(con, &p)?;
    }
    Ok(())
}

/// Add or remove one column name in a JSON gap list.
/// The limitation date, entered by a person (Q52: the portal does not
/// state it yet) or, once the parser learns it, by intake with
/// `source = "portal"`. Any change writes a `limitation_changed` event.
pub fn set_limitation_date(con: &Connection, proceeding_id: &str, date: Option<&str>, source: &str) -> AppResult<()> {
    let Some(mut p) = get(con, proceeding_id)? else { return Ok(()); };
    if p.limitation_date.as_deref() == date { return Ok(()); }
    let from = p.limitation_date.clone();
    p.limitation_date = date.map(str::to_string);
    p.gap_flags = Some(with_gap(p.gap_flags.as_deref(), "limitation_date", date.is_none()));
    p.updated_at = crate::ids::now();
    save(con, &p)?;
    crate::repo::events::limitation_changed(con, proceeding_id, from.as_deref(), date, source)
}

pub fn with_gap(current: Option<&str>, column: &str, is_gap: bool) -> String {
    let mut gaps: Vec<String> = current
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let present = gaps.iter().any(|g| g == column);
    if is_gap && !present {
        gaps.push(column.to_string());
    } else if !is_gap && present {
        gaps.retain(|g| g != column);
    }
    gaps.sort();
    serde_json::to_string(&gaps).unwrap_or_else(|_| "[]".into())
}

pub fn set_manual_due_date(con: &Connection, proceeding_id: &str, date: Option<&str>) -> AppResult<()> {
    let Some(mut p) = get(con, proceeding_id)? else {
        return Err(crate::error::AppError::not_found("proceeding"));
    };
    p.manual_due_date = date.map(str::to_string);
    p.updated_at = crate::ids::now();
    save(con, &p)
}
