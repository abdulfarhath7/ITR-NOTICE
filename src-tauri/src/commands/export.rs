//! Excel export (docs/08 `export_excel`).

use crate::commands::lock_db;
use crate::error::AppResult;
use crate::export::{self, ExportReport, ExportScope};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn export_excel(state: State<AppState>, scope: ExportScope, path: String) -> AppResult<ExportReport> {
    let con = lock_db(&state)?;
    export::export_workbook(&con, &scope, &path)
}

/// Row counts per module for a scope, shown on the control before the
/// user commits (docs/11 "Scope selector").
#[tauri::command]
pub fn export_preview(state: State<AppState>, scope: ExportScope) -> AppResult<Vec<(String, i64)>> {
    let con = lock_db(&state)?;
    let mut out = Vec::new();
    for (module, table) in [("proceedings", "proceedings"), ("demands", "demands"), ("returns", "returns"), ("forms", "filed_forms")] {
        let n: i64 = match &scope {
            ExportScope::All => con.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?,
            ExportScope::Client { client_id } => con.query_row(
                &format!("SELECT count(*) FROM {table} x JOIN year_contexts yc ON yc.id = x.year_context_id WHERE yc.client_id = ?1"),
                [client_id], |r| r.get(0))?,
            ExportScope::View { items, .. } => items.iter().filter(|(m, _)| m == module).count() as i64,
        };
        out.push((module.to_string(), n));
    }
    Ok(out)
}
