//! The encrypted archive. One SQLCipher file in the user's app-data folder is
//! the whole record. The schema lives in `migrations/` and is applied by
//! `migrate.rs` on every open; everything else is in `repo/`.
//!
//! What remains here is the notice-list DTO the current dashboard reads.
//! It is a projection of communications joined to their proceeding, year
//! context and client; the screens in docs/09 replace it in Phases 2–3.

use crate::error::{AppError, AppResult};
use crate::repo::{documents, drafts, proceedings};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub type DbResult<T> = Result<T, String>;

fn e(err: impl std::fmt::Display) -> String {
    err.to_string()
}

/// Open (or create) the encrypted archive. `key` is the hex key held in the
/// OS keychain - never on disk next to the file.
pub fn open(path: &Path, key: &str) -> DbResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(e)?;
    }
    let mut con = Connection::open(path).map_err(e)?;
    // SQLCipher: the key pragma must be the first statement on the connection.
    // Raw-key form (x'HEX') so no KDF runs on open; execute_batch keeps the
    // quotes exactly as SQLCipher wants them (pragma_update would re-quote).
    con.execute_batch(&format!("PRAGMA key = \"x'{key}'\";")).map_err(e)?;
    con.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;").map_err(e)?;
    // Migrating here also proves the key is right; a wrong key surfaces as
    // "file is not a database" on this line, not later.
    crate::migrate::run(&mut con).map_err(e)?;
    Ok(con)
}

// ------------------------------------------------------------ rows out

/// A notice as the drafting commands see it - never the blob.
#[derive(Debug, Serialize, Clone)]
pub struct NoticeRow {
    pub ref_id: String,
    pub communication_id: String,
    pub proceeding_id: String,
    pub client_id: String,
    pub notice_us: Option<String>,
    pub description: Option<String>,
    pub issued_on: Option<String>,
    pub served_on: Option<String>,
    /// Portal-stated only. Never an AI date.
    pub due_date: Option<String>,
    pub suggested_due_date: Option<String>,
    pub manual_due_date: Option<String>,
    pub due_date_source: Option<String>,
    pub due_date_basis: Option<String>,
    pub responded: Option<i64>,
    pub has_pdf: bool,
    pub has_draft: bool,
    pub proceeding_name: Option<String>,
    pub pan: Option<String>,
    pub client_name: String,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    /// The proceeding's status from the state machine.
    pub status: Option<String>,
    pub communication_status: String,
    pub gap_flags: Option<String>,
    pub verified_flag: i64,
}

/// One notice by its portal reference: what the drafting commands need.
pub fn get_notice(con: &Connection, ref_id: &str) -> AppResult<Option<NoticeRow>> {
    let mut st = con.prepare(
        r#"SELECT c.reference_id, c.id, p.id, cl.id, c.section_1961, c.description, c.issued_on,
                  c.served_on, c.response_due_date, p.suggested_due_date, p.manual_due_date,
                  c.status,
                  EXISTS(SELECT 1 FROM documents d WHERE d.parent_type = 'communication'
                         AND d.parent_id = c.id AND d.state = 'stored'),
                  EXISTS(SELECT 1 FROM drafts dr WHERE dr.communication_id = c.id),
                  p.display_name, cl.pan, cl.name, p.assessee_name, yc.assessment_year,
                  p.status, c.gap_flags, c.verified_flag
           FROM communications c
           JOIN proceedings p ON p.id = c.proceeding_id
           JOIN year_contexts yc ON yc.id = p.year_context_id
           JOIN clients cl ON cl.id = yc.client_id
           WHERE c.reference_id = ?1"#,
    )?;
    let mut rows = st.query_map([ref_id], |r| {
        let comm_status: String = r.get(11)?;
        let responded = match comm_status.as_str() {
            "response_submitted" => Some(1),
            "open" | "adjournment_sought" => Some(0),
            _ => None,
        };
        let due: Option<String> = r.get(8)?;
        Ok(NoticeRow {
            ref_id: r.get(0)?, communication_id: r.get(1)?, proceeding_id: r.get(2)?,
            client_id: r.get(3)?, notice_us: r.get(4)?, description: r.get(5)?,
            issued_on: r.get(6)?, served_on: r.get(7)?,
            due_date_source: due.as_ref().map(|_| "portal".to_string()), due_date: due,
            suggested_due_date: r.get(9)?, manual_due_date: r.get(10)?, due_date_basis: None,
            responded, has_pdf: r.get(12)?, has_draft: r.get(13)?, proceeding_name: r.get(14)?,
            pan: r.get(15)?, client_name: r.get(16)?, assessee_name: r.get(17)?,
            assessment_year: r.get(18)?, status: r.get(19)?, communication_status: comm_status,
            gap_flags: r.get(20)?, verified_flag: r.get(21)?,
        })
    })?;
    Ok(rows.next().transpose()?)
}

/// The notice PDF, by the portal reference id.
pub fn get_pdf(con: &Connection, ref_id: &str) -> AppResult<Option<Vec<u8>>> {
    let Some(comm) = proceedings::communication_by_reference(con, ref_id)? else { return Ok(None); };
    let Some(doc) = documents::find(con, "communication", &comm.id, "communication")? else { return Ok(None); };
    match doc.file_hash {
        Some(h) => documents::read_blob(con, &h),
        None => Ok(None),
    }
}

/// An AI-suggested date is written to `suggested_due_date` only, with
/// `verified_flag = 0`; it is never promoted here (docs/02, Phase 9).
pub fn set_suggested_due_date(con: &Connection, ref_id: &str, due: &str) -> AppResult<()> {
    let comm = proceedings::communication_by_reference(con, ref_id)?
        .ok_or_else(|| AppError::not_found("notice"))?;
    let mut p = proceedings::get(con, &comm.proceeding_id)?
        .ok_or_else(|| AppError::not_found("proceeding"))?;
    p.suggested_due_date = Some(due.to_string());
    p.verified_flag = 0;
    p.updated_at = crate::ids::now();
    proceedings::save(con, &p)
}

/// The dashboard's draft shape, keyed by the portal reference id.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Draft {
    pub ref_id: String,
    pub generated_at: Option<String>,
    pub summary: String,
    pub checklist: Vec<String>,
    pub draft_text: String,
}

pub fn get_draft(con: &Connection, ref_id: &str) -> AppResult<Option<Draft>> {
    let Some(comm) = proceedings::communication_by_reference(con, ref_id)? else { return Ok(None); };
    Ok(drafts::for_communication(con, &comm.id)?.map(|d| Draft {
        ref_id: ref_id.to_string(),
        generated_at: d.generated_at,
        summary: d.summary.unwrap_or_default(),
        checklist: d.checklist_json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
        draft_text: d.draft_text.unwrap_or_default(),
    }))
}

pub fn save_draft(con: &Connection, d: &Draft, model: Option<&str>) -> AppResult<()> {
    let comm = proceedings::communication_by_reference(con, &d.ref_id)?
        .ok_or_else(|| AppError::not_found("notice"))?;
    let ts = crate::ids::now();
    let existing = drafts::for_communication(con, &comm.id)?;
    let row = crate::repo::model::Draft {
        id: existing.as_ref().map(|x| x.id.clone()).unwrap_or_else(crate::ids::new_id),
        communication_id: comm.id,
        generated_at: Some(ts.clone()),
        model: model.map(str::to_string),
        summary: Some(d.summary.clone()),
        checklist_json: Some(serde_json::to_string(&d.checklist)?),
        draft_text: Some(d.draft_text.clone()),
        created_at: existing.map(|x| x.created_at).unwrap_or_else(|| ts.clone()),
        updated_at: ts,
    };
    drafts::save(con, &row)
}

pub fn update_draft_text(con: &Connection, ref_id: &str, text: &str) -> AppResult<()> {
    let comm = proceedings::communication_by_reference(con, ref_id)?
        .ok_or_else(|| AppError::not_found("notice"))?;
    let mut d = drafts::for_communication(con, &comm.id)?
        .ok_or_else(|| AppError::not_found("draft"))?;
    d.draft_text = Some(text.to_string());
    d.updated_at = crate::ids::now();
    drafts::save(con, &d)
}
