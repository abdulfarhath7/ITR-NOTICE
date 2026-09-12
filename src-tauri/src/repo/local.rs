//! `local_kv`: this installation's own state. Never synced.

use crate::error::AppResult;
use rusqlite::{params, Connection, OptionalExtension};

pub const DEVICE_ID: &str = "device_id";

pub fn get(con: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(con.query_row("SELECT value FROM local_kv WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn set(con: &Connection, key: &str, value: &str) -> AppResult<()> {
    con.execute(
        "INSERT INTO local_kv (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, crate::ids::now()],
    )?;
    Ok(())
}

/// The device id is minted on first open and never changes for this
/// installation; ledger streams are keyed by it.
pub fn device_id(con: &Connection) -> AppResult<String> {
    if let Some(id) = get(con, DEVICE_ID)? {
        return Ok(id);
    }
    let id = format!("dev_{}", &crate::ids::new_id()[..8]);
    set(con, DEVICE_ID, &id)?;
    Ok(id)
}
