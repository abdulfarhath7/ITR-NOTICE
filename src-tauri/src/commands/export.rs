//! Excel export (docs/08 `export_excel`).

use crate::commands::lock_db;
use crate::error::AppResult;
use crate::export::{self, ExportOptions, ExportPreview, ExportReport, ExportScope};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn export_excel(state: State<AppState>, scope: ExportScope, path: String, options: Option<ExportOptions>) -> AppResult<ExportReport> {
    let con = lock_db(&state)?;
    export::export_workbook_with(&con, &scope, &options.unwrap_or_default(), &path)
}

/// The dialog's sheet preview and suggested filename (docs/18 §4.1, §4.3):
/// the same header strings and cells the workbook will carry.
#[tauri::command]
pub fn preview_export_sheet(state: State<AppState>, scope: ExportScope, options: Option<ExportOptions>,
                            window: Option<String>) -> AppResult<ExportPreview> {
    let con = lock_db(&state)?;
    export::preview_proceedings(&con, &scope, &options.unwrap_or_default(), window.as_deref())
}

/// docs/18 §5: the client book, registration fields only, never a credential.
#[tauri::command]
pub fn export_clients(state: State<AppState>, path: String) -> AppResult<usize> {
    let con = lock_db(&state)?;
    export::export_clients(&con, &path)
}

/// docs/18 §7: the run log of one sweep.
#[tauri::command]
pub fn export_sweep_run(state: State<AppState>, sweep_id: String, path: String) -> AppResult<usize> {
    let con = lock_db(&state)?;
    export::export_sweep_run(&con, &sweep_id, &path)
}

#[tauri::command]
pub fn sweep_run_export_name(state: State<AppState>, sweep_id: String) -> AppResult<String> {
    let con = lock_db(&state)?;
    Ok(export::sweep_run_file_name(&con, &sweep_id))
}

#[tauri::command]
pub fn clients_export_name() -> String {
    export::clients_file_name()
}

/// Every proceedings-sheet column in order, for the picker.
#[tauri::command]
pub fn export_columns() -> Vec<String> {
    export::PROCEEDING_SHEET.iter().map(|c| c.header.to_string()).collect()
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

/// Export the Updates screen: one sheet per group (task 17.4).
#[tauri::command]
pub fn export_updates(state: State<AppState>, since: Option<String>, path: String) -> AppResult<usize> {
    let con = lock_db(&state)?;
    let report = crate::repo::updates::list(&con, since)?;
    export::export_updates(&con, &report, &path)
}
