//! Sync surface (docs/08): the local half now — this device, its cursor
//! map, bundles in and out. The relay half arrives in Phase 7.

use crate::bundle::{self, ExportOptions, ExportSummary, ImportOptions, ImportSummary, Manifest};
use crate::commands::lock_db;
use crate::error::{AppError, AppResult};
use crate::ledger::{self, CursorMap};
use crate::repo::local;
use crate::AppState;
use serde::Serialize;
use std::collections::BTreeMap;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub public_key: String,
    pub cursor: CursorMap,
    pub own_entries: i64,
    pub entries_by_device: BTreeMap<String, i64>,
    pub last_snapshot_at: Option<String>,
    pub snapshot_due: bool,
}

#[tauri::command]
pub fn get_device_info(state: State<AppState>) -> AppResult<DeviceInfo> {
    let con = lock_db(&state)?;
    let device_id = local::device_id(&con)?;
    let key = bundle::signing_key()?;
    let mut st = con.prepare("SELECT device_id, count(*) FROM ledger GROUP BY device_id")?;
    let by: BTreeMap<String, i64> = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(DeviceInfo {
        own_entries: *by.get(&device_id).unwrap_or(&0),
        public_key: bundle::public_key_b64(&key),
        cursor: ledger::full_cursor_map(&con)?,
        entries_by_device: by,
        last_snapshot_at: local::get(&con, "last_snapshot_at")?,
        snapshot_due: crate::snapshot::due(&con)?,
        device_id,
    })
}

#[tauri::command]
pub fn export_bundle(state: State<AppState>, path: String, passphrase: String, include_credentials: bool,
                     include_documents: Option<bool>) -> AppResult<ExportSummary> {
    let con = lock_db(&state)?;
    bundle::export(&con, &path, &passphrase, &ExportOptions {
        include_documents: include_documents.unwrap_or(true), include_credentials,
    })
}

/// Read the manifest without merging, so the screen can show what a
/// bundle holds before the user confirms.
#[tauri::command]
pub fn peek_bundle(path: String, passphrase: String) -> AppResult<Manifest> {
    bundle::peek(&path, &passphrase)
}

#[tauri::command]
pub fn import_bundle(state: State<AppState>, path: String, passphrase: String, write_credentials: Option<bool>) -> AppResult<ImportSummary> {
    let mut con = lock_db(&state)?;
    bundle::import(&mut con, &path, &passphrase, &ImportOptions { write_credentials: write_credentials.unwrap_or(false) })
}

#[tauri::command]
pub fn check_passphrase(passphrase: String) -> AppResult<()> {
    bundle::passphrase_strong_enough(&passphrase).map_err(AppError::invalid)
}
