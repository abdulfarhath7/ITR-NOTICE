//! Claude through the server-side proxy. A suggestion is stored as one;
//! a draft is cached per notice and never regenerated on its own.

use crate::claude::{DraftAnswer, DueDateAnswer, Proxy};
use crate::commands::lock_db;
use crate::commands::settings::read_settings;
use crate::db::{self, Draft};
use crate::error::{AppError, AppResult};
use crate::repo::model::Status;
use crate::AppState;
use tauri::State;

fn proxy(state: &AppState) -> AppResult<Proxy> {
    let s = read_settings(state);
    if s.firm_token.is_empty() {
        return Err(AppError::state("add your firm token in Settings first"));
    }
    Ok(Proxy { base_url: s.proxy_url, firm_token: s.firm_token })
}

#[tauri::command]
pub fn get_draft(state: State<AppState>, ref_id: String) -> AppResult<Option<Draft>> {
    let con = lock_db(&state)?;
    db::get_draft(&con, &ref_id)
}

#[tauri::command]
pub fn save_draft_text(state: State<AppState>, ref_id: String, draft_text: String) -> AppResult<()> {
    let con = lock_db(&state)?;
    db::update_draft_text(&con, &ref_id, &draft_text)
}

/// docs/08 `suggest_due_date`: writes `suggested_due_date` only, with
/// `verified_flag = 0`. Never the stated column.
#[tauri::command]
pub async fn suggest_due_date(state: State<'_, AppState>, ref_id: String) -> AppResult<DueDateAnswer> {
    let (row, pdf) = {
        let con = lock_db(&state)?;
        let row = db::get_notice(&con, &ref_id)?.ok_or_else(|| AppError::not_found("notice"))?;
        let pdf = db::get_pdf(&con, &ref_id)?;
        (row, pdf)
    };
    // A portal-stated date is the truth and is never asked about. A
    // suggestion already on file is returned as-is: never called twice.
    if let Some(d) = row.due_date.clone() {
        return Ok(DueDateAnswer { due_date: Some(d), basis: Some("stated on the portal".into()) });
    }
    if let Some(d) = row.suggested_due_date.clone() {
        return Ok(DueDateAnswer { due_date: Some(d), basis: Some("suggested earlier".into()) });
    }
    let pdf = pdf.ok_or_else(|| AppError::state("no PDF stored yet - run a sync first"))?;
    let ans = proxy(&state)?
        .due_date(&ref_id, &pdf, row.issued_on.as_deref(), row.served_on.as_deref()).await
        .map_err(|e| AppError::Proxy { message: e })?;
    if let Some(d) = ans.due_date.as_deref() {
        let con = lock_db(&state)?;
        // Suggestion column only, never the stated one (docs/02, Phase 9).
        db::set_suggested_due_date(&con, &ref_id, d)?;
    }
    Ok(ans)
}

/// docs/08 `create_draft`: cached per notice; the proxy is never called
/// twice for the same notice.
#[tauri::command]
pub async fn create_draft(state: State<'_, AppState>, ref_id: String) -> AppResult<Draft> {
    let (row, pdf, existing) = {
        let con = lock_db(&state)?;
        (db::get_notice(&con, &ref_id)?.ok_or_else(|| AppError::not_found("notice"))?,
         db::get_pdf(&con, &ref_id)?,
         db::get_draft(&con, &ref_id)?)
    };
    if let Some(d) = existing {
        return Ok(d);
    }
    // The action matrix: no draft on a submitted or closed item.
    let status = if row.communication_status == "response_submitted" {
        Status::ResponseSubmitted
    } else {
        Status::parse(row.status.as_deref().unwrap_or("unknown"))
    };
    if !status.allows_draft() {
        return Err(AppError::state(format!("no draft for a {} item", status.as_str().replace('_', " "))));
    }
    let pdf = pdf.ok_or_else(|| AppError::state("no PDF stored yet - run a sync first"))?;
    let a: DraftAnswer = proxy(&state)?
        .draft(&ref_id, &pdf, row.notice_us.as_deref(), row.assessee_name.as_deref(),
               row.assessment_year.as_deref()).await
        .map_err(|e| AppError::Proxy { message: e })?;
    let d = Draft { ref_id: ref_id.clone(), generated_at: None,
                    summary: a.summary, checklist: a.checklist, draft_text: a.draft_reply,
                    reviewed_at: None };
    let con = lock_db(&state)?;
    db::save_draft(&con, &d, None)?;
    db::get_draft(&con, &ref_id)?.ok_or_else(|| AppError::not_found("draft"))
}

/// The explicit human action that turns a suggestion into a date the app
/// acts on. It writes the manual due date (Q14: the manual date may sit
/// beside a portal date and drives the worklist); the portal's stated date
/// is never touched and the row stays machine-read.
#[tauri::command]
pub fn promote_suggested_due_date(state: State<AppState>, proceeding_id: String) -> AppResult<()> {
    let con = lock_db(&state)?;
    let p = crate::repo::proceedings::get(&con, &proceeding_id)?.ok_or_else(|| AppError::not_found("proceeding"))?;
    if !Status::parse(&p.status).allows_manual_due_date() {
        return Err(AppError::state("this item is settled; its dates are no longer editable"));
    }
    let suggested = p.suggested_due_date.clone().ok_or_else(|| AppError::state("there is no suggested date to promote"))?;
    crate::repo::proceedings::set_manual_due_date(&con, &proceeding_id, Some(&suggested))
}

/// "Mark reviewed" in the draft drawer (docs/16 §2.3): sets or clears
/// `reviewed_at` on the notice's draft.
#[tauri::command]
pub fn set_draft_reviewed(state: State<AppState>, ref_id: String, reviewed: bool) -> AppResult<()> {
    let con = lock_db(&state)?;
    let comm = crate::repo::proceedings::communication_by_reference(&con, &ref_id)?
        .ok_or_else(|| AppError::not_found("notice"))?;
    crate::repo::drafts::set_reviewed(&con, &comm.id, reviewed)
}
