//! Demands, returns and filed forms: row mappers, lookups, saves.

use crate::error::AppResult;
use crate::repo::model::{Demand, DemandResponse, FiledForm, Payment, Return};
use crate::repo::rows;
use rusqlite::{Connection, OptionalExtension, Row};

pub fn demand_row(r: &Row) -> rusqlite::Result<Demand> {
    Ok(Demand {
        id: r.get("id")?, year_context_id: r.get("year_context_id")?, natural_key: r.get("natural_key")?,
        demand_reference_number: r.get("demand_reference_number")?, demand_amount: r.get("demand_amount")?,
        current_outstanding: r.get("current_outstanding")?, section_or_demand_type: r.get("section_or_demand_type")?,
        raised_on: r.get("raised_on")?, uploaded_by: r.get("uploaded_by")?,
        rectification_rights: r.get("rectification_rights")?, status: r.get("status")?,
        portal_status: r.get("portal_status")?, proceeding_id: r.get("proceeding_id")?,
        verified_flag: r.get("verified_flag")?, gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?,
        first_seen_at: r.get("first_seen_at")?, last_seen_at: r.get("last_seen_at")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn demand_response_row(r: &Row) -> rusqlite::Result<DemandResponse> {
    Ok(DemandResponse {
        id: r.get("id")?, demand_id: r.get("demand_id")?, stance: r.get("stance")?,
        reason_code_id: r.get("reason_code_id")?, disputed_amount: r.get("disputed_amount")?,
        filed_on: r.get("filed_on")?, transaction_id: r.get("transaction_id")?,
        verified_flag: r.get("verified_flag")?, gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn payment_row(r: &Row) -> rusqlite::Result<Payment> {
    Ok(Payment {
        id: r.get("id")?, year_context_id: r.get("year_context_id")?,
        demand_response_id: r.get("demand_response_id")?, proceeding_id: r.get("proceeding_id")?,
        purpose: r.get("purpose")?, cin: r.get("cin")?, bsr_code: r.get("bsr_code")?, paid_on: r.get("paid_on")?,
        amount: r.get("amount")?, verified_flag: r.get("verified_flag")?, gap_flags: r.get("gap_flags")?,
        row_hash: r.get("row_hash")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn return_row(r: &Row) -> rusqlite::Result<Return> {
    Ok(Return {
        id: r.get("id")?, year_context_id: r.get("year_context_id")?,
        acknowledgement_number: r.get("acknowledgement_number")?, return_type: r.get("return_type")?,
        filing_type: r.get("filing_type")?, filed_on: r.get("filed_on")?,
        verification_status: r.get("verification_status")?, processing_status: r.get("processing_status")?,
        status: r.get("status")?, supersedes_id: r.get("supersedes_id")?, verified_flag: r.get("verified_flag")?,
        gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?, first_seen_at: r.get("first_seen_at")?,
        last_seen_at: r.get("last_seen_at")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn filed_form_row(r: &Row) -> rusqlite::Result<FiledForm> {
    Ok(FiledForm {
        id: r.get("id")?, year_context_id: r.get("year_context_id")?, form_type_id: r.get("form_type_id")?,
        acknowledgement_number: r.get("acknowledgement_number")?, form_label: r.get("form_label")?,
        filed_on: r.get("filed_on")?, filing_type: r.get("filing_type")?, portal_status: r.get("portal_status")?,
        status: r.get("status")?, filed_by: r.get("filed_by")?, verified_flag: r.get("verified_flag")?,
        gap_flags: r.get("gap_flags")?, row_hash: r.get("row_hash")?, first_seen_at: r.get("first_seen_at")?,
        last_seen_at: r.get("last_seen_at")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn get_demand(con: &Connection, id: &str) -> AppResult<Option<Demand>> {
    Ok(con.query_row("SELECT * FROM demands WHERE id = ?1", [id], demand_row).optional()?)
}
pub fn demand_by_natural_key(con: &Connection, key: &str) -> AppResult<Option<Demand>> {
    Ok(con.query_row("SELECT * FROM demands WHERE natural_key = ?1", [key], demand_row).optional()?)
}
pub fn save_demand(con: &Connection, d: &Demand) -> AppResult<()> { rows::upsert(con, "demands", d) }

pub fn demand_responses_for(con: &Connection, demand_id: &str) -> AppResult<Vec<DemandResponse>> {
    let mut st = con.prepare("SELECT * FROM demand_responses WHERE demand_id = ?1 ORDER BY filed_on IS NULL, filed_on")?;
    let rows = st.query_map([demand_id], demand_response_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
pub fn save_demand_response(con: &Connection, r: &DemandResponse) -> AppResult<()> { rows::upsert(con, "demand_responses", r) }

pub fn payments_for_year(con: &Connection, year_context_id: &str) -> AppResult<Vec<Payment>> {
    let mut st = con.prepare("SELECT * FROM payments WHERE year_context_id = ?1 ORDER BY paid_on IS NULL, paid_on")?;
    let rows = st.query_map([year_context_id], payment_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
pub fn save_payment(con: &Connection, p: &Payment) -> AppResult<()> { rows::upsert(con, "payments", p) }

pub fn get_return(con: &Connection, id: &str) -> AppResult<Option<Return>> {
    Ok(con.query_row("SELECT * FROM returns WHERE id = ?1", [id], return_row).optional()?)
}
pub fn return_by_ack(con: &Connection, ack: &str) -> AppResult<Option<Return>> {
    Ok(con.query_row("SELECT * FROM returns WHERE acknowledgement_number = ?1", [ack], return_row).optional()?)
}
pub fn returns_for_year(con: &Connection, year_context_id: &str) -> AppResult<Vec<Return>> {
    let mut st = con.prepare("SELECT * FROM returns WHERE year_context_id = ?1 ORDER BY filed_on IS NULL, filed_on")?;
    let rows = st.query_map([year_context_id], return_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
pub fn save_return(con: &Connection, r: &Return) -> AppResult<()> { rows::upsert(con, "returns", r) }

pub fn get_filed_form(con: &Connection, id: &str) -> AppResult<Option<FiledForm>> {
    Ok(con.query_row("SELECT * FROM filed_forms WHERE id = ?1", [id], filed_form_row).optional()?)
}
pub fn filed_form_by_ack(con: &Connection, ack: &str) -> AppResult<Option<FiledForm>> {
    Ok(con.query_row("SELECT * FROM filed_forms WHERE acknowledgement_number = ?1", [ack], filed_form_row).optional()?)
}
pub fn save_filed_form(con: &Connection, f: &FiledForm) -> AppResult<()> { rows::upsert(con, "filed_forms", f) }
