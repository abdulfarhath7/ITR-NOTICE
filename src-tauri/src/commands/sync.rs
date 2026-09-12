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

// ------------------------------------------------------------ relay

use crate::relay::{self, Relay, RelayConfig, Roster};
use crate::sync::{self, SyncResult, SyncState};

#[derive(Debug, Serialize)]
pub struct FirmCreated {
    pub config: RelayConfig,
    /// Shown once. Stored nowhere on this device.
    pub recovery_code: String,
}

/// The device id and "not yet enrolled" check, without holding the lock
/// across the network call that follows.
fn fresh_device_id(state: &AppState) -> AppResult<String> {
    let con = lock_db(state)?;
    if relay::config(&con)?.is_some() {
        return Err(AppError::state("this device is already enrolled with a firm"));
    }
    local::device_id(&con)
}

fn store(state: &AppState, e: &relay::Enrolment) -> AppResult<()> {
    let con = lock_db(state)?;
    relay::store_enrolment(&con, e)
}

#[tauri::command]
pub async fn register_firm(state: State<'_, AppState>, relay_url: String, firm_name: String, device_name: String) -> AppResult<FirmCreated> {
    if firm_name.trim().is_empty() || device_name.trim().is_empty() {
        return Err(AppError::invalid("firm name and device name are required"));
    }
    let device_id = fresh_device_id(&state)?;
    let e = Relay::register_firm(relay_url.trim(), &device_id, firm_name.trim(), device_name.trim()).await?;
    store(&state, &e)?;
    Ok(FirmCreated { config: e.config, recovery_code: e.recovery_code })
}

#[tauri::command]
pub async fn enrol_device(state: State<'_, AppState>, relay_url: String, invite: String, device_name: String) -> AppResult<RelayConfig> {
    let device_id = fresh_device_id(&state)?;
    let e = Relay::enrol(relay_url.trim(), &device_id, &invite, device_name.trim()).await?;
    store(&state, &e)?;
    // A new device starts from the latest snapshot, then the tail.
    let _ = sync::bootstrap_from_snapshot(&state.db).await;
    let _ = sync::sync_now(&state.db).await;
    Ok(e.config)
}

#[tauri::command]
pub async fn recover_admin(state: State<'_, AppState>, relay_url: String, firm_id: String, recovery_code: String,
                           firm_key_hex: String, device_name: String) -> AppResult<FirmCreated> {
    let device_id = { let con = lock_db(&state)?; local::device_id(&con)? };
    let e = Relay::recover(relay_url.trim(), &device_id, firm_id.trim(), recovery_code.trim(), &firm_key_hex, device_name.trim()).await?;
    store(&state, &e)?;
    let _ = sync::bootstrap_from_snapshot(&state.db).await;
    let _ = sync::sync_now(&state.db).await;
    Ok(FirmCreated { config: e.config, recovery_code: e.recovery_code })
}

fn relay_for(state: &AppState) -> AppResult<Relay> {
    let con = lock_db(state)?;
    Ok(Relay::new(relay::require_config(&con)?))
}

#[tauri::command]
pub async fn list_devices(state: State<'_, AppState>) -> AppResult<Roster> {
    let relay = relay_for(&state)?;
    let roster = relay.roster().await?;
    // Remember our permission and the collector for the offline state.
    if let Ok(con) = state.db.lock() {
        if let Some(p) = roster.you.get("permission").and_then(|v| v.as_str()) { let _ = local::set(&con, relay::KEY_PERMISSION, p); }
        if let Some(c) = roster.devices.iter().find(|d| d.role == "collector" && d.removed_at.is_none()) {
            let _ = local::set(&con, relay::KEY_COLLECTOR_ID, &c.id);
            if let Some(seen) = &c.last_seen { let _ = local::set(&con, relay::KEY_COLLECTOR_SEEN, seen); }
        }
    }
    Ok(roster)
}

#[tauri::command]
pub async fn create_invite(state: State<'_, AppState>) -> AppResult<String> {
    relay_for(&state)?.create_invite().await
}

#[tauri::command]
pub async fn set_collector(state: State<'_, AppState>, device_id: String) -> AppResult<()> {
    relay_for(&state)?.set_collector(&device_id).await
}

#[tauri::command]
pub async fn remove_device(state: State<'_, AppState>, device_id: String) -> AppResult<()> {
    relay_for(&state)?.remove_device(&device_id).await
}

#[tauri::command]
pub async fn transfer_admin(state: State<'_, AppState>, device_id: String) -> AppResult<()> {
    relay_for(&state)?.transfer_admin(&device_id).await?;
    if let Ok(con) = state.db.lock() { let _ = local::set(&con, relay::KEY_PERMISSION, "member"); }
    Ok(())
}

#[tauri::command]
pub fn get_sync_state(state: State<AppState>) -> AppResult<SyncState> {
    let con = lock_db(&state)?;
    sync::state(&con)
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> AppResult<SyncResult> {
    let mut result = sync::sync_now(&state.db).await?;
    // The collector also keeps the snapshot fresh (Q07).
    if let Ok(true) = sync::publish_snapshot_if_due(&state.db).await { result.snapshot_published = true; }
    Ok(result)
}

/// Leave the firm on this device only: relay config and firm key are
/// dropped locally; the archive stays. Removal from the roster is the
/// admin's action on their own device.
#[tauri::command]
pub fn leave_firm(state: State<AppState>) -> AppResult<()> {
    let con = lock_db(&state)?;
    for k in [relay::KEY_URL, relay::KEY_FIRM, relay::KEY_FIRM_NAME, relay::KEY_PERMISSION, relay::KEY_HEADS,
              relay::KEY_COLLECTOR_ID, relay::KEY_COLLECTOR_SEEN, relay::KEY_LAST_ERROR, relay::KEY_LAST_SYNC] {
        con.execute("DELETE FROM local_kv WHERE key = ?1", [k])?;
    }
    let _ = crate::keychain::forget_secret(relay::FIRM_KEY);
    Ok(())
}
