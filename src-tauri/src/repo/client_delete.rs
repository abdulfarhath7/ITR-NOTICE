//! Deleting a client and everything under it. Every row goes through
//! `rows::delete_with`, so each delete is a ledger entry and other devices
//! remove the same rows on their next sync. Children go first: the archive
//! enforces foreign keys, and a replaying device applies the entries in the
//! same order.

use crate::error::{AppError, AppResult};
use crate::repo::rows::{self, Origin};
use rusqlite::{params, Connection, Transaction};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct DeletePreview {
    pub client_id: String,
    pub name: String,
    pub years: i64,
    /// Proceedings, demands, returns and filed forms.
    pub work_items: i64,
    pub communications: i64,
    pub documents: i64,
    /// Another client in the book signs in with the same login, so the
    /// stored password stays.
    pub login_shared: bool,
}

const CLIENT_YEARS: &str = "SELECT id FROM year_contexts WHERE client_id = ?1";
const CLIENT_PROCEEDINGS: &str =
    "SELECT p.id FROM proceedings p JOIN year_contexts y ON y.id = p.year_context_id WHERE y.client_id = ?1";

fn ids(con: &Connection, sql: &str, client_id: &str) -> AppResult<Vec<String>> {
    let mut st = con.prepare(sql)?;
    let rows = st.query_map([client_id], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn count(con: &Connection, sql: &str, client_id: &str) -> AppResult<i64> {
    Ok(con.query_row(&format!("SELECT count(*) FROM ({sql})"), [client_id], |r| r.get(0))?)
}

/// Every document under the client, whatever its parent.
fn documents_sql() -> String {
    format!(
        "SELECT d.id FROM documents d WHERE
            (d.parent_type = 'proceeding' AND d.parent_id IN ({CLIENT_PROCEEDINGS}))
         OR (d.parent_type = 'communication' AND d.parent_id IN (SELECT id FROM communications WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})))
         OR (d.parent_type = 'response' AND d.parent_id IN (SELECT id FROM responses WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})))
         OR (d.parent_type = 'adjournment_request' AND d.parent_id IN (SELECT id FROM adjournment_requests WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})))
         OR (d.parent_type = 'demand' AND d.parent_id IN (SELECT id FROM demands WHERE year_context_id IN ({CLIENT_YEARS})))
         OR (d.parent_type = 'demand_response' AND d.parent_id IN (SELECT r.id FROM demand_responses r JOIN demands m ON m.id = r.demand_id WHERE m.year_context_id IN ({CLIENT_YEARS})))
         OR (d.parent_type = 'payment' AND d.parent_id IN (SELECT id FROM payments WHERE year_context_id IN ({CLIENT_YEARS})))
         OR (d.parent_type = 'return' AND d.parent_id IN (SELECT id FROM returns WHERE year_context_id IN ({CLIENT_YEARS})))
         OR (d.parent_type = 'filed_form' AND d.parent_id IN (SELECT id FROM filed_forms WHERE year_context_id IN ({CLIENT_YEARS})))")
}

fn login_of(con: &Connection, client_id: &str) -> AppResult<(String, String)> {
    con.query_row("SELECT name, coalesce(portal_login_ref, pan) FROM clients WHERE id = ?1", [client_id],
                  |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| AppError::not_found("client"))
}

pub fn login_shared(con: &Connection, client_id: &str, login: &str) -> AppResult<bool> {
    let n: i64 = con.query_row(
        "SELECT count(*) FROM clients WHERE id <> ?1 AND coalesce(portal_login_ref, pan) = ?2",
        params![client_id, login], |r| r.get(0))?;
    Ok(n > 0)
}

pub fn preview(con: &Connection, client_id: &str) -> AppResult<DeletePreview> {
    let (name, login) = login_of(con, client_id)?;
    let items = format!(
        "{CLIENT_PROCEEDINGS}
         UNION ALL SELECT id FROM demands WHERE year_context_id IN ({CLIENT_YEARS})
         UNION ALL SELECT id FROM returns WHERE year_context_id IN ({CLIENT_YEARS})
         UNION ALL SELECT id FROM filed_forms WHERE year_context_id IN ({CLIENT_YEARS})");
    Ok(DeletePreview {
        client_id: client_id.into(), name,
        years: count(con, CLIENT_YEARS, client_id)?,
        work_items: count(con, &items, client_id)?,
        communications: count(con, &format!("SELECT id FROM communications WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})"), client_id)?,
        documents: count(con, &documents_sql(), client_id)?,
        login_shared: login_shared(con, client_id, &login)?,
    })
}

fn delete_all(tx: &Transaction, table: &str, list: &[String]) -> AppResult<()> {
    for id in list { rows::delete_with(tx, table, id, Origin::Local)?; }
    Ok(())
}

/// Remove the client, children first, in one transaction. Returns the
/// login the client signed in with, so the caller can drop the stored
/// password when no other client uses it.
pub fn delete(con: &mut Connection, client_id: &str) -> AppResult<(String, bool)> {
    let (_, login) = login_of(con, client_id)?;
    let shared = login_shared(con, client_id, &login)?;
    let tx = con.transaction()?;
    let c = client_id;

    let documents = ids(&tx, &documents_sql(), c)?;
    delete_all(&tx, "documents", &documents)?;
    delete_all(&tx, "drafts", &ids(&tx, &format!(
        "SELECT id FROM drafts WHERE communication_id IN (SELECT id FROM communications WHERE proceeding_id IN ({CLIENT_PROCEEDINGS}))"), c)?)?;
    delete_all(&tx, "work_item_meta", &ids(&tx, &format!(
        "SELECT id FROM work_item_meta WHERE
            (module = 'proceedings' AND item_id IN ({CLIENT_PROCEEDINGS}))
         OR (module = 'demands' AND item_id IN (SELECT id FROM demands WHERE year_context_id IN ({CLIENT_YEARS})))
         OR (module = 'returns' AND item_id IN (SELECT id FROM returns WHERE year_context_id IN ({CLIENT_YEARS})))
         OR (module = 'forms' AND item_id IN (SELECT id FROM filed_forms WHERE year_context_id IN ({CLIENT_YEARS})))"), c)?)?;
    delete_all(&tx, "responses", &ids(&tx, &format!("SELECT id FROM responses WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})"), c)?)?;
    delete_all(&tx, "adjournment_requests", &ids(&tx, &format!("SELECT id FROM adjournment_requests WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})"), c)?)?;
    delete_all(&tx, "communications", &ids(&tx, &format!("SELECT id FROM communications WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})"), c)?)?;
    delete_all(&tx, "payments", &ids(&tx, &format!("SELECT id FROM payments WHERE year_context_id IN ({CLIENT_YEARS})"), c)?)?;
    delete_all(&tx, "demand_responses", &ids(&tx, &format!(
        "SELECT r.id FROM demand_responses r JOIN demands m ON m.id = r.demand_id WHERE m.year_context_id IN ({CLIENT_YEARS})"), c)?)?;
    delete_all(&tx, "demands", &ids(&tx, &format!("SELECT id FROM demands WHERE year_context_id IN ({CLIENT_YEARS})"), c)?)?;
    // A revised return points at the one it supersedes: newest first.
    loop {
        let leaves = ids(&tx, &format!(
            "SELECT id FROM returns r WHERE year_context_id IN ({CLIENT_YEARS})
               AND NOT EXISTS (SELECT 1 FROM returns s WHERE s.supersedes_id = r.id)"), c)?;
        if leaves.is_empty() { break; }
        delete_all(&tx, "returns", &leaves)?;
    }
    delete_all(&tx, "filed_forms", &ids(&tx, &format!("SELECT id FROM filed_forms WHERE year_context_id IN ({CLIENT_YEARS})"), c)?)?;
    delete_all(&tx, "proceeding_events", &ids(&tx, &format!("SELECT id FROM proceeding_events WHERE proceeding_id IN ({CLIENT_PROCEEDINGS})"), c)?)?;
    delete_all(&tx, "proceedings", &ids(&tx, CLIENT_PROCEEDINGS, c)?)?;
    delete_all(&tx, "year_contexts", &ids(&tx, CLIENT_YEARS, c)?)?;

    // Local rows: the run audit keeps its rows without the client; queued
    // work for the client goes.
    tx.execute("UPDATE ingestion_runs SET client_id = NULL WHERE client_id = ?1", [c])?;
    tx.execute("UPDATE ingestion_jobs SET client_id = NULL WHERE client_id = ?1", [c])?;
    tx.execute("DELETE FROM deep_fetch_requests WHERE client_id = ?1", [c])?;
    if !shared { tx.execute("DELETE FROM probe_state WHERE login_ref = ?1", [&login])?; }

    rows::delete_with(&tx, "clients", c, Origin::Local)?;
    // Bytes no document points at any more.
    tx.execute("DELETE FROM document_blobs WHERE file_hash NOT IN
                  (SELECT file_hash FROM documents WHERE file_hash IS NOT NULL)", [])?;
    tx.commit()?;
    Ok((login, shared))
}

