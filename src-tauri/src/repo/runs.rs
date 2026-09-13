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
    })
}

pub fn record(con: &Connection, run: &IngestionRun) -> AppResult<()> {
    rows::upsert(con, "ingestion_runs", run)
}

pub fn latest(con: &Connection) -> AppResult<Option<IngestionRun>> {
    Ok(con.query_row("SELECT * FROM ingestion_runs ORDER BY run_at DESC LIMIT 1", [], from_row)
        .optional()?)
}

