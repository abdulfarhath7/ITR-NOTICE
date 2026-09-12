//! Migration 0009: carry the pre-build archive (legacy_proceedings,
//! legacy_notices, legacy_drafts) into the work-item spine. No data loss:
//! the migration reconciles row counts at the end and refuses — rolling the
//! whole transaction back — if anything did not carry across.
//!
//! The mapping itself is `intake::absorb`, the same code live ingestion
//! uses, so backfilled and freshly swept rows are indistinguishable.

use crate::intake::{absorb, NoticeCard, ProceedingCard};
use crate::migrate::MigrateError;
use crate::repo::{drafts, local, proceedings};
use rusqlite::{OptionalExtension, Transaction};
use std::collections::HashMap;

const VERSION: u32 = 9;

fn refuse(reason: impl Into<String>) -> MigrateError {
    MigrateError::Refused { version: VERSION, reason: reason.into() }
}

fn app_err(e: crate::error::AppError) -> MigrateError {
    refuse(e.to_string())
}

pub fn run(tx: &Transaction) -> Result<(), MigrateError> {
    let legacy_count: i64 = tx.query_row("SELECT count(*) FROM legacy_proceedings", [], |r| r.get(0))?;
    let notice_count: i64 = tx.query_row("SELECT count(*) FROM legacy_notices", [], |r| r.get(0))?;
    if legacy_count == 0 && notice_count == 0 {
        return Ok(());
    }

    // The "Self" tab is the logged-in taxpayer's by definition, so a Self
    // card that did not print a PAN belongs to the PAN the other Self cards
    // printed. The most frequent one wins; a tie is resolved alphabetically
    // so the result is deterministic.
    let self_pan: Option<String> = tx.query_row(
        "SELECT pan FROM legacy_proceedings WHERE pan IS NOT NULL AND pan <> ''
         GROUP BY pan ORDER BY sum(tab = 'self') DESC, count(*) DESC, pan LIMIT 1",
        [], |r| r.get(0)).optional()?;

    // legacy proceeding id -> card, so each notice can be absorbed under it
    let mut cards: HashMap<i64, ProceedingCard> = HashMap::new();
    {
        let mut st = tx.prepare(
            "SELECT id, tab, sub_tab, proceeding_name, pan, assessee_name, assessment_year,
                    financial_year, applicable_act, status, closure_date, closure_order
             FROM legacy_proceedings ORDER BY id")?;
        let rows = st.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, ProceedingCard {
                tab: r.get(1)?, sub_tab: r.get(2)?, proceeding_name: r.get(3)?, pan: r.get(4)?,
                assessee_name: r.get(5)?, assessment_year: r.get(6)?, financial_year: r.get(7)?,
                applicable_act: r.get(8)?, status: r.get(9)?, closure_date: r.get(10)?,
                closure_order: r.get(11)?,
            }))
        })?;
        for row in rows {
            let (id, card) = row?;
            absorb(tx, self_pan.as_deref(), &card, None).map_err(app_err)?;
            cards.insert(id, card);
        }
    }

    let mut comm_by_ref: HashMap<String, String> = HashMap::new();
    {
        let mut st = tx.prepare(
            "SELECT proceeding_id, ref_id, notice_us, doc_ref_id, description, issued_on, served_on,
                    due_date, due_date_source, ao_viewed_on, responded, downloaded_at, pdf_blob
             FROM legacy_notices ORDER BY id")?;
        let rows = st.query_map([], |r| {
            Ok((r.get::<_, Option<i64>>(0)?, NoticeCard {
                ref_id: r.get(1)?, notice_us: r.get(2)?, doc_ref_id: r.get(3)?, description: r.get(4)?,
                issued_on: r.get(5)?, served_on: r.get(6)?, due_date: r.get(7)?,
                due_date_source: r.get(8)?, ao_viewed_on: r.get(9)?, responded: r.get(10)?,
                downloaded_at: r.get(11)?, pdf: r.get(12)?,
            }))
        })?;
        for row in rows {
            let (pid, notice) = row?;
            let card = pid.and_then(|id| cards.get(&id))
                .ok_or_else(|| refuse(format!("legacy notice {} has no proceeding", notice.ref_id)))?;
            let out = absorb(tx, self_pan.as_deref(), card, Some(&notice)).map_err(app_err)?;
            if let Some(cid) = out.communication_id {
                comm_by_ref.insert(notice.ref_id.clone(), cid);
            }
        }
    }

    // Drafts, re-keyed from ref_id to communication id.
    {
        let mut st = tx.prepare(
            "SELECT ref_id, generated_at, summary, checklist_json, draft_text FROM legacy_drafts")?;
        let rows = st.query_map([], |r| Ok((
            r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?)))?;
        for row in rows {
            let (ref_id, generated_at, summary, checklist_json, draft_text) = row?;
            let Some(cid) = comm_by_ref.get(&ref_id) else {
                return Err(refuse(format!("legacy draft {ref_id} has no notice")));
            };
            let ts = crate::ids::now();
            drafts::save(tx, &crate::repo::model::Draft {
                id: crate::ids::new_id(), communication_id: cid.clone(),
                generated_at: generated_at.as_deref().and_then(sqlite_stamp).or(generated_at),
                model: None, summary, checklist_json, draft_text,
                created_at: ts.clone(), updated_at: ts,
            }).map_err(app_err)?;
        }
    }

    // Reconcile. Counts must match exactly or nothing is kept.
    let proceedings_now: i64 = tx.query_row("SELECT count(*) FROM proceedings", [], |r| r.get(0))?;
    let comms_now: i64 = tx.query_row("SELECT count(*) FROM communications", [], |r| r.get(0))?;
    let pdfs_before: i64 = tx.query_row(
        "SELECT count(*) FROM legacy_notices WHERE pdf_blob IS NOT NULL AND length(pdf_blob) > 1", [], |r| r.get(0))?;
    let docs_now: i64 = tx.query_row(
        "SELECT count(*) FROM documents WHERE state = 'stored' AND parent_type = 'communication'", [], |r| r.get(0))?;
    let drafts_before: i64 = tx.query_row("SELECT count(*) FROM legacy_drafts", [], |r| r.get(0))?;
    let drafts_now: i64 = tx.query_row("SELECT count(*) FROM drafts", [], |r| r.get(0))?;

    if proceedings_now != legacy_count {
        return Err(refuse(format!("proceedings: {legacy_count} before, {proceedings_now} after")));
    }
    if comms_now != notice_count {
        return Err(refuse(format!("notices: {notice_count} before, {comms_now} communications after")));
    }
    if docs_now != pdfs_before {
        return Err(refuse(format!("PDFs: {pdfs_before} before, {docs_now} documents after")));
    }
    if drafts_now != drafts_before {
        return Err(refuse(format!("drafts: {drafts_before} before, {drafts_now} after")));
    }
    for id in proceedings_ids(tx)? {
        proceedings::refresh_due_date(tx, &id).map_err(app_err)?;
    }

    local::set(tx, "backfill_0009", &serde_json::json!({
        "proceedings": proceedings_now, "communications": comms_now,
        "documents": docs_now, "drafts": drafts_now, "at": crate::ids::now(),
    }).to_string()).map_err(app_err)?;
    Ok(())
}

fn proceedings_ids(tx: &Transaction) -> Result<Vec<String>, rusqlite::Error> {
    let mut st = tx.prepare("SELECT id FROM proceedings")?;
    let rows = st.query_map([], |r| r.get(0))?;
    rows.collect()
}

fn sqlite_stamp(s: &str) -> Option<String> {
    let s = s.trim();
    (s.len() == 19 && s.as_bytes()[10] == b' ').then(|| format!("{}T{}Z", &s[..10], &s[11..]))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    /// Acceptance for task 1.8, run by hand against a copy of a real legacy
    /// archive: `LEGACY_DB=/path/to/copy.db cargo test legacy_archive -- --ignored --nocapture`.
    /// (`LEGACY_DB_ORIGINAL` points at an untouched second copy for the spot
    /// check.) Prints counts before and after and spot-checks ten notices
    /// field by field. Never prints names or PANs.
    #[test]
    #[ignore]
    fn legacy_archive_reconciles() {
        let Ok(path) = std::env::var("LEGACY_DB") else { return; };
        let mut con = Connection::open(&path).unwrap();
        let before: (i64, i64, i64, i64) = con.query_row(
            "SELECT (SELECT count(*) FROM proceedings), (SELECT count(*) FROM notices),
                    (SELECT count(*) FROM notices WHERE pdf_blob IS NOT NULL),
                    (SELECT count(*) FROM drafts)", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        crate::migrate::run(&mut con).unwrap();
        let after: (i64, i64, i64, i64) = con.query_row(
            "SELECT (SELECT count(*) FROM proceedings), (SELECT count(*) FROM communications),
                    (SELECT count(*) FROM documents WHERE state='stored'), (SELECT count(*) FROM drafts)",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        println!("before (proceedings, notices, pdfs, drafts) = {before:?}");
        println!("after  (proceedings, communications, documents, drafts) = {after:?}");
        assert_eq!(before, after);

        let clients: i64 = con.query_row("SELECT count(*) FROM clients", [], |r| r.get(0)).unwrap();
        let ycs: i64 = con.query_row("SELECT count(*) FROM year_contexts", [], |r| r.get(0)).unwrap();
        println!("clients = {clients}, year_contexts = {ycs}");

        // Ten notices, field by field: reference, DIN, dates (converted),
        // status mapping, PDF hash presence. Compared against a second,
        // untouched copy of the legacy file since 0010 drops the legacy
        // tables in the migrated one.
        con.execute("ATTACH DATABASE ?1 AS legacy", [std::env::var("LEGACY_DB_ORIGINAL").unwrap()]).unwrap();
        let mut st = con.prepare(
            "SELECT n.ref_id, n.doc_ref_id, n.issued_on, n.due_date, n.responded, n.pdf_blob IS NOT NULL,
                    c.reference_id, c.din, c.issued_on, c.response_due_date, c.status,
                    (SELECT count(*) FROM documents d WHERE d.parent_id = c.id AND d.state='stored'),
                    p.status, lp.status, lp.assessment_year, yc.assessment_year
             FROM legacy.notices n
             JOIN communications c ON c.reference_id = n.ref_id
             JOIN proceedings p ON p.id = c.proceeding_id
             JOIN year_contexts yc ON yc.id = p.year_context_id
             JOIN legacy.proceedings lp ON lp.id = n.proceeding_id
             ORDER BY n.id LIMIT 10").unwrap();
        let rows = st.query_map([], |r| Ok((
            r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?, r.get::<_, Option<i64>>(4)?, r.get::<_, bool>(5)?,
            r.get::<_, String>(6)?, r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?,
            r.get::<_, Option<String>>(9)?, r.get::<_, String>(10)?, r.get::<_, i64>(11)?,
            r.get::<_, String>(12)?, r.get::<_, Option<String>>(13)?, r.get::<_, Option<String>>(14)?,
            r.get::<_, Option<String>>(15)?,
        ))).unwrap();
        for row in rows {
            let (ref_id, din0, issued0, due0, responded, had_pdf, ref1, din1, issued1, due1,
                 cstatus, docs, pstatus, lstatus, ay0, ay1) = row.unwrap();
            assert_eq!(ref_id, ref1);
            assert_eq!(din0, din1);
            assert_eq!(crate::dates::to_iso(issued0.as_deref()), issued1);
            assert_eq!(crate::dates::to_iso(due0.as_deref()), due1);
            assert_eq!(had_pdf, docs == 1);
            let expected_c = match responded { Some(1) => "response_submitted",
                Some(0) => if pstatus == "closed" { "closed" } else { "open" },
                _ => if pstatus == "closed" { "closed" } else { "unknown" } };
            assert_eq!(cstatus, expected_c);
            assert_eq!(pstatus, crate::repo::model::Status::from_portal(lstatus.as_deref()).as_str());
            assert_eq!(ay0.filter(|s| !s.is_empty()), ay1);
            println!("ok  ref={ref_id} issued={issued1:?} due={due1:?} status={cstatus} pdf={docs} ay={ay1:?}");
        }
    }
}
