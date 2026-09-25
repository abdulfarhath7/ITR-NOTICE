//! ingestion_runs: one row per (client, module, panel) per sweep, zero
//! counts included.

use crate::error::AppResult;
use crate::repo::model::IngestionRun;
use crate::repo::rows;
use rusqlite::{Connection, OptionalExtension, Row};

pub fn from_row(r: &Row) -> rusqlite::Result<IngestionRun> {
    Ok(IngestionRun {
        id: r.get("id")?, run_at: r.get("run_at")?, device_id: r.get("device_id")?,
        client_id: r.get("client_id")?, module: r.get("module")?, panel_swept: r.get("panel_swept")?,
        records_found: r.get("records_found")?, gaps: r.get("gaps")?, operator: r.get("operator")?,
        status: r.get("status")?, notes: r.get("notes")?, created_at: r.get("created_at")?,
        scope: r.get::<_, Option<String>>("scope").unwrap_or(None).unwrap_or_else(|| "sweep".into()),
    })
}

pub fn record(con: &Connection, run: &IngestionRun) -> AppResult<()> {
    rows::upsert(con, "ingestion_runs", run)
}

pub fn latest(con: &Connection) -> AppResult<Option<IngestionRun>> {
    Ok(con.query_row("SELECT * FROM ingestion_runs ORDER BY run_at DESC LIMIT 1", [], from_row)
        .optional()?)
}


/// The Attention screen's sync line (docs/16 §1.1): when the latest sweep
/// ran, how many clients it touched and how many of its runs failed or
/// parked on credentials. The window is the sweep that holds the newest
/// run; a run outside any recorded sweep (an attended one-off) is its own
/// window.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncLine {
    pub last_run_at: Option<String>,
    pub window_start: Option<String>,
    pub clients: i64,
    pub failed: i64,
}

pub fn sync_line(con: &Connection) -> AppResult<SyncLine> {
    let last: Option<String> = con.query_row("SELECT max(run_at) FROM ingestion_runs", [], |r| r.get(0))?;
    let Some(last) = last else {
        return Ok(SyncLine { last_run_at: None, window_start: None, clients: 0, failed: 0 });
    };
    let start: String = con.query_row(
        "SELECT started_at FROM ingestion_sweeps WHERE started_at <= ?1 ORDER BY started_at DESC LIMIT 1",
        [&last], |r| r.get(0)).optional()?.unwrap_or_else(|| last.clone());
    let (clients, failed): (i64, i64) = con.query_row(
        "SELECT count(DISTINCT client_id),
                coalesce(sum(status IN ('failed','credentials_parked')), 0)
         FROM ingestion_runs WHERE run_at >= ?1 AND run_at <= ?2",
        [&start, &last], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(SyncLine { last_run_at: Some(last), window_start: Some(start), clients, failed })
}
