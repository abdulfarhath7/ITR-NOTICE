//! Tauri commands, grouped by surface (docs/08-api-contract.md). Each is a
//! thin handler: lock the archive, call the repository, return a DTO.
//! `AppError` is the only error type that crosses the boundary.

pub mod ai;
pub mod clients;
pub mod documents;
pub mod export;
pub mod ingestion;
pub mod settings;
pub mod sync;
pub mod work_items;

use crate::error::{AppError, AppResult};
use crate::AppState;
use rusqlite::Connection;
use std::sync::MutexGuard;

pub fn lock_db(state: &AppState) -> AppResult<MutexGuard<'_, Connection>> {
    state.db.lock().map_err(|e| AppError::state(format!("archive is busy: {e}")))
}
