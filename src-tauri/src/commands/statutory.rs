//! Statutory calendar commands (docs/19 §9).

use crate::commands::lock_db;
use crate::error::{AppError, AppResult};
use crate::repo::model::FirmDate;
use crate::statutory::{self, fetch, repo};
use crate::AppState;
use tauri::State;

fn today() -> chrono::NaiveDate { crate::ingest::scheduler::ist_now().date() }

#[tauri::command]
pub fn list_statutory(state: State<AppState>, from: String, to: String, scope: Option<String>) -> AppResult<Vec<repo::StatutoryItem>> {
    let con = lock_db(&state)?;
    repo::list(&con, &from, &to, scope.as_deref().unwrap_or("all"), &today().format("%Y-%m-%d").to_string())
}

/// docs/19 §3 now. Plain HTTPS, no credentials, no session lock.
#[tauri::command]
pub async fn refresh_statutory(state: State<'_, AppState>) -> AppResult<Vec<fetch::Outcome>> {
    fetch::refresh(&state.db, today()).await
}

#[tauri::command]
pub fn statutory_status(state: State<AppState>) -> AppResult<repo::StatutoryStatus> {
    let con = lock_db(&state)?;
    let s = statutory::settings(&con)?;
    let next = if s.refresh == "nightly" { "tonight" } else { "the run window's first enabled day" };
    repo::status(&con, next)
}

#[tauri::command]
pub fn get_calendar_settings(state: State<AppState>) -> AppResult<statutory::CalendarSettings> {
    let con = lock_db(&state)?;
    statutory::settings(&con)
}

#[tauri::command]
pub fn set_calendar_settings(state: State<AppState>, settings: statutory::CalendarSettings) -> AppResult<()> {
    let con = lock_db(&state)?;
    statutory::set_settings(&con, &settings)
}

#[tauri::command]
pub fn list_firm_dates(state: State<AppState>) -> AppResult<Vec<FirmDate>> {
    let con = lock_db(&state)?;
    repo::list_firm_dates(&con)
}

#[tauri::command]
pub fn upsert_firm_date(state: State<AppState>, id: Option<String>, due_on: String, title: String, note: Option<String>) -> AppResult<FirmDate> {
    let con = lock_db(&state)?;
    let by = crate::repo::local::get(&con, "operator_name").ok().flatten();
    repo::upsert_firm_date(&con, id.as_deref(), due_on.trim(), &title, note.as_deref(), by.as_deref())
}

#[tauri::command]
pub fn delete_firm_date(state: State<AppState>, id: String) -> AppResult<()> {
    let con = lock_db(&state)?;
    repo::delete_firm_date(&con, &id)
}

/// docs/19 §7: writes the FY's statutory and firm layers to `path`.
#[tauri::command]
pub fn export_statutory_ics(state: State<AppState>, fy_start_year: i32, path: String) -> AppResult<String> {
    let text = { let con = lock_db(&state)?; repo::ics(&con, fy_start_year)? };
    std::fs::write(&path, text).map_err(|e| AppError::Io { message: format!("could not write the calendar file: {e}") })?;
    Ok(path)
}

/// docs/19 §2.4: set by a person on the Profile tab, never inferred.
#[tauri::command]
pub fn set_client_calendar_profile(state: State<AppState>, client_id: String, entity_kind: Option<String>,
                                   audit_case: bool, tp_case: bool, tds_deductor: bool) -> AppResult<()> {
    let con = lock_db(&state)?;
    let kind = entity_kind.map(|k| k.trim().to_lowercase()).filter(|k| !k.is_empty());
    if let Some(k) = &kind {
        if !matches!(k.as_str(), "individual" | "huf" | "firm" | "llp" | "company" | "trust" | "other") {
            return Err(AppError::invalid("unknown entity kind"));
        }
    }
    let mut c = crate::repo::clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    // An unset kind is stored as an empty string so the clear is written (D-039).
    c.entity_kind = Some(kind.unwrap_or_default());
    c.audit_case = Some(i64::from(audit_case));
    c.tp_case = Some(i64::from(tp_case));
    c.tds_deductor = Some(i64::from(tds_deductor));
    c.updated_at = crate::ids::now();
    crate::repo::clients::save(&con, &c)
}
