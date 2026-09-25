use crate::commands::lock_db;
use crate::error::{AppError, AppResult};
use crate::repo::model::Status;
use crate::repo::work_items::{self, DemandDetail, FiledFormDetail, ProceedingDetail, ReturnDetail, WorkItemFilter, WorkItemRow};
use crate::repo::meta::{self, MetaPatch, WorkItemMeta};
use crate::repo::{local, proceedings, registry};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn list_work_items(state: State<AppState>, filter: Option<WorkItemFilter>) -> AppResult<Vec<WorkItemRow>> {
    let con = lock_db(&state)?;
    work_items::list(&con, &filter.unwrap_or_default())
}

#[tauri::command]
pub fn get_proceeding(state: State<AppState>, id: String) -> AppResult<ProceedingDetail> {
    let con = lock_db(&state)?;
    work_items::proceeding_detail(&con, &id)?.ok_or_else(|| AppError::not_found("proceeding"))
}

/// A manual date may override the portal's (Q14, answered): both are kept,
/// both are shown, the manual one drives the worklist. The portal's own
/// field is never overwritten. Follows the action matrix.
#[tauri::command]
pub fn set_manual_due_date(state: State<AppState>, proceeding_id: String, date: Option<String>) -> AppResult<()> {
    let con = lock_db(&state)?;
    let p = proceedings::get(&con, &proceeding_id)?.ok_or_else(|| AppError::not_found("proceeding"))?;
    if !Status::parse(&p.status).allows_manual_due_date() {
        return Err(AppError::state("this item is settled; its dates are no longer editable"));
    }
    let date = date.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    if let Some(d) = &date {
        if crate::dates::parse_portal_date(d).is_none() {
            return Err(AppError::invalid("enter the date as YYYY-MM-DD"));
        }
    }
    let iso = date.and_then(|d| crate::dates::to_iso(Some(&d)));
    proceedings::set_manual_due_date(&con, &proceeding_id, iso.as_deref())
}

/// docs/18 §3: the statutory clock, entered by a person until the portal
/// parser confirms a label (Q52). Every change is a `limitation_changed`
/// event with `source = manual`.
#[tauri::command]
pub fn set_limitation_date(state: State<AppState>, proceeding_id: String, date: Option<String>) -> AppResult<()> {
    let con = lock_db(&state)?;
    let p = proceedings::get(&con, &proceeding_id)?.ok_or_else(|| AppError::not_found("proceeding"))?;
    if !Status::parse(&p.status).allows_manual_due_date() {
        return Err(AppError::state("this item is settled; its dates are no longer editable"));
    }
    let date = date.map(|d| d.trim().to_string()).filter(|d| !d.is_empty());
    if let Some(d) = &date {
        if crate::dates::parse_portal_date(d).is_none() {
            return Err(AppError::invalid("enter the date as YYYY-MM-DD"));
        }
    }
    let iso = date.and_then(|d| crate::dates::to_iso(Some(&d)));
    proceedings::set_limitation_date(&con, &proceeding_id, iso.as_deref(), "manual")
}

#[tauri::command]
pub fn list_registry(state: State<AppState>, registry_name: String) -> AppResult<Vec<crate::repo::model::TypeEntry>> {
    let con = lock_db(&state)?;
    registry::list(&con, &registry_name)
}

#[tauri::command]
pub fn get_demand(state: State<AppState>, id: String) -> AppResult<DemandDetail> {
    let con = lock_db(&state)?;
    work_items::demand_detail(&con, &id)?.ok_or_else(|| AppError::not_found("demand"))
}

#[tauri::command]
pub fn get_return(state: State<AppState>, id: String) -> AppResult<ReturnDetail> {
    let con = lock_db(&state)?;
    work_items::return_detail(&con, &id)?.ok_or_else(|| AppError::not_found("return"))
}

#[tauri::command]
pub fn get_filed_form(state: State<AppState>, id: String) -> AppResult<FiledFormDetail> {
    let con = lock_db(&state)?;
    work_items::filed_form_detail(&con, &id)?.ok_or_else(|| AppError::not_found("form"))
}

#[tauri::command]
pub fn get_work_item_meta(state: State<AppState>, module: String, id: String) -> AppResult<Option<WorkItemMeta>> {
    let con = lock_db(&state)?;
    meta::get(&con, &module, &id)
}

/// Owner and note (docs/16 §2.2). A field left out is unchanged; an empty
/// string clears it. User-authored, so any device may write it.
#[tauri::command]
pub fn set_work_item_meta(state: State<AppState>, module: String, id: String,
                          assignee: Option<String>, note: Option<String>) -> AppResult<WorkItemMeta> {
    let con = lock_db(&state)?;
    let device = local::device_id(&con)?;
    meta::set(&con, &module, &id, MetaPatch { assignee, note }, &device)
}

/// Every owner name in use, for the owner select.
#[tauri::command]
pub fn list_assignees(state: State<AppState>) -> AppResult<Vec<String>> {
    let con = lock_db(&state)?;
    meta::assignees(&con)
}
