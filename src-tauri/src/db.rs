//! The encrypted archive. One SQLCipher file in the user's app-data folder is
//! the whole record: notices, their PDFs, drafts. The schema lives in
//! `migrations/` and is applied by `migrate.rs` on every open.

use rusqlite::{params, Connection, OptionalExtension};
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
    con.execute_batch("PRAGMA journal_mode = WAL;").map_err(e)?;
    // Migrating here also proves the key is right; a wrong key surfaces as
    // "file is not a database" on this line, not later.
    crate::migrate::run(&mut con).map_err(e)?;
    Ok(con)
}

// ------------------------------------------------------------ rows in

/// A notice as the sidecar reports it (one "notice" event = one of these).
#[derive(Debug, Deserialize)]
pub struct IncomingNotice {
    pub ref_id: String,
    pub notice_us: Option<String>,
    pub doc_ref_id: Option<String>,
    pub description: Option<String>,
    pub issued_on: Option<String>,
    pub served_on: Option<String>,
    pub due_date: Option<String>,
    pub due_date_source: Option<String>,
    pub ao_viewed_on: Option<String>,
    pub responded: Option<i64>,
    pub downloaded_at: Option<String>,
    pub pdf_b64: Option<String>,
    // proceeding
    pub tab: Option<String>,
    pub sub_tab: Option<String>,
    pub proceeding_name: Option<String>,
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub financial_year: Option<String>,
    pub applicable_act: Option<String>,
    pub proceeding_status: Option<String>,
    pub closure_date: Option<String>,
    pub closure_order: Option<String>,
}

pub fn absorb_notice(con: &Connection, n: &IncomingNotice, pdf: Option<Vec<u8>>) -> DbResult<()> {
    let tab = n.tab.clone().unwrap_or_else(|| "self".into());
    let sub = n.sub_tab.clone().unwrap_or_else(|| "action".into());
    con.execute(
        r#"INSERT INTO proceedings (tab, sub_tab, proceeding_name, pan, assessee_name,
              assessment_year, financial_year, applicable_act, status, closure_date, closure_order)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
           ON CONFLICT(tab, sub_tab, proceeding_name, pan, assessment_year) DO UPDATE SET
              assessee_name=excluded.assessee_name, status=excluded.status,
              closure_date=excluded.closure_date, closure_order=excluded.closure_order,
              last_seen=datetime('now')"#,
        params![tab, sub, n.proceeding_name, n.pan, n.assessee_name, n.assessment_year,
                n.financial_year, n.applicable_act, n.proceeding_status,
                n.closure_date, n.closure_order],
    ).map_err(e)?;
    let pid: i64 = con.query_row(
        "SELECT id FROM proceedings WHERE tab=?1 AND sub_tab=?2 AND proceeding_name IS ?3
           AND pan IS ?4 AND assessment_year IS ?5",
        params![tab, sub, n.proceeding_name, n.pan, n.assessment_year],
        |r| r.get(0),
    ).map_err(e)?;

    // Keep an existing PDF if this event carries none (the staging cache
    // replays a row without the blob after the first time).
    con.execute(
        r#"INSERT INTO notices (proceeding_id, ref_id, notice_us, doc_ref_id, description,
              issued_on, served_on, due_date, due_date_source, ao_viewed_on, responded,
              pdf_blob, downloaded_at)
           VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
           ON CONFLICT(ref_id) DO UPDATE SET
              proceeding_id=excluded.proceeding_id, notice_us=excluded.notice_us,
              description=excluded.description, issued_on=excluded.issued_on,
              served_on=excluded.served_on, ao_viewed_on=excluded.ao_viewed_on,
              responded=excluded.responded,
              due_date=CASE WHEN notices.due_date_source='claude' THEN notices.due_date ELSE excluded.due_date END,
              due_date_source=CASE WHEN notices.due_date_source='claude' THEN 'claude' ELSE excluded.due_date_source END,
              pdf_blob=COALESCE(excluded.pdf_blob, notices.pdf_blob),
              downloaded_at=COALESCE(excluded.downloaded_at, notices.downloaded_at)"#,
        params![pid, n.ref_id, n.notice_us, n.doc_ref_id, n.description, n.issued_on,
                n.served_on, n.due_date, n.due_date_source.clone().or(Some("portal".into())),
                n.ao_viewed_on, n.responded, pdf, n.downloaded_at],
    ).map_err(e)?;
    Ok(())
}

// ------------------------------------------------------------ rows out

/// What the list needs - never the blob.
#[derive(Debug, Serialize, Clone)]
pub struct NoticeRow {
    pub ref_id: String,
    pub notice_us: Option<String>,
    pub description: Option<String>,
    pub issued_on: Option<String>,
    pub served_on: Option<String>,
    pub due_date: Option<String>,
    pub due_date_source: Option<String>,
    pub due_date_basis: Option<String>,
    pub responded: Option<i64>,
    pub has_pdf: bool,
    pub has_draft: bool,
    pub proceeding_name: Option<String>,
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub status: Option<String>,
}

pub fn list_notices(con: &Connection) -> DbResult<Vec<NoticeRow>> {
    let mut st = con.prepare(
        r#"SELECT n.ref_id, n.notice_us, n.description, n.issued_on, n.served_on,
                  n.due_date, n.due_date_source, n.due_date_basis, n.responded,
                  n.pdf_blob IS NOT NULL,
                  EXISTS(SELECT 1 FROM drafts d WHERE d.ref_id = n.ref_id),
                  p.proceeding_name, p.pan, p.assessee_name, p.assessment_year, p.status
           FROM notices n LEFT JOIN proceedings p ON p.id = n.proceeding_id
           ORDER BY n.due_date IS NULL, n.due_date"#,
    ).map_err(e)?;
    let rows = st.query_map([], |r| {
        Ok(NoticeRow {
            ref_id: r.get(0)?, notice_us: r.get(1)?, description: r.get(2)?,
            issued_on: r.get(3)?, served_on: r.get(4)?, due_date: r.get(5)?,
            due_date_source: r.get(6)?, due_date_basis: r.get(7)?, responded: r.get(8)?,
            has_pdf: r.get(9)?, has_draft: r.get(10)?, proceeding_name: r.get(11)?,
            pan: r.get(12)?, assessee_name: r.get(13)?, assessment_year: r.get(14)?,
            status: r.get(15)?,
        })
    }).map_err(e)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(e)
}

pub fn get_pdf(con: &Connection, ref_id: &str) -> DbResult<Option<Vec<u8>>> {
    con.query_row("SELECT pdf_blob FROM notices WHERE ref_id=?1", [ref_id], |r| r.get(0))
        .optional().map_err(e).map(|o: Option<Option<Vec<u8>>>| o.flatten())
}

pub fn get_notice(con: &Connection, ref_id: &str) -> DbResult<Option<NoticeRow>> {
    Ok(list_notices(con)?.into_iter().find(|n| n.ref_id == ref_id))
}

pub fn set_claude_due_date(con: &Connection, ref_id: &str, due: &str, basis: Option<&str>) -> DbResult<()> {
    con.execute(
        "UPDATE notices SET due_date=?1, due_date_source='claude', due_date_basis=?2 WHERE ref_id=?3",
        params![due, basis, ref_id],
    ).map_err(e)?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Draft {
    pub ref_id: String,
    pub generated_at: Option<String>,
    pub summary: String,
    pub checklist: Vec<String>,
    pub draft_text: String,
}

pub fn get_draft(con: &Connection, ref_id: &str) -> DbResult<Option<Draft>> {
    con.query_row(
        "SELECT ref_id, generated_at, summary, checklist_json, draft_text FROM drafts WHERE ref_id=?1",
        [ref_id],
        |r| {
            let cj: Option<String> = r.get(3)?;
            Ok(Draft {
                ref_id: r.get(0)?, generated_at: r.get(1)?,
                summary: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                checklist: cj.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default(),
                draft_text: r.get::<_, Option<String>>(4)?.unwrap_or_default(),
            })
        },
    ).optional().map_err(e)
}

pub fn save_draft(con: &Connection, d: &Draft) -> DbResult<()> {
    con.execute(
        r#"INSERT INTO drafts (ref_id, generated_at, summary, checklist_json, draft_text)
           VALUES (?1, datetime('now'), ?2, ?3, ?4)
           ON CONFLICT(ref_id) DO UPDATE SET generated_at=datetime('now'),
              summary=excluded.summary, checklist_json=excluded.checklist_json,
              draft_text=excluded.draft_text"#,
        params![d.ref_id, d.summary, serde_json::to_string(&d.checklist).map_err(e)?, d.draft_text],
    ).map_err(e)?;
    Ok(())
}

pub fn update_draft_text(con: &Connection, ref_id: &str, text: &str) -> DbResult<()> {
    con.execute("UPDATE drafts SET draft_text=?1 WHERE ref_id=?2", params![text, ref_id]).map_err(e)?;
    Ok(())
}
