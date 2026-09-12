// Repository functions are written ahead of the phases that call them
// (TASKS.md); the dead-code lint is re-enabled once Phase 7 lands.
#![allow(dead_code)]

mod backfill;
mod bundle;
mod claude;
mod commands;
mod csv_import;
mod dates;
mod db;
mod error;
mod export;
mod gstin;
mod ids;
mod ingest;
mod intake;
mod intake_modules;
mod keychain;
mod ledger;
mod merge;
mod mask;
mod migrate;
mod relay;
mod repo;
mod snapshot;
mod sync;

use db::NoticeRow;
use error::AppResult;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub settings_path: std::path::PathBuf,
    /// Unencrypted scratch for documents handed to the OS viewer; cleared
    /// on every launch.
    pub temp_dir: std::path::PathBuf,
    pub ingestion: commands::ingestion::IngestionService,
}

/// The legacy notice list the current dashboard reads. Replaced screen by
/// screen by `list_work_items`.
#[tauri::command]
fn list_notices(state: State<AppState>) -> AppResult<Vec<NoticeRow>> {
    let con = commands::lock_db(&state)?;
    db::list_notices(&con)
}

/// Base64 so the webview can build a blob: URL and show it in an <iframe>.
#[tauri::command]
fn get_notice_pdf(state: State<AppState>, ref_id: String) -> AppResult<String> {
    use base64::Engine;
    let con = commands::lock_db(&state)?;
    let pdf = db::get_pdf(&con, &ref_id)?.ok_or_else(|| error::AppError::not_found("PDF for this notice"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(pdf))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let key = keychain::db_key()?;
            let con = db::open(&data_dir.join("archive.db"), &key)?;
            let temp_dir = data_dir.join("viewer-temp");
            commands::documents::clear_temp(&temp_dir);
            app.manage(AppState {
                db: Arc::new(Mutex::new(con)),
                settings_path: data_dir.join("settings.json"),
                temp_dir,
                ingestion: commands::ingestion::IngestionService::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings, commands::settings::save_settings,
            list_notices, get_notice_pdf,
            commands::ai::get_draft, commands::ai::save_draft_text,
            commands::ai::suggest_due_date, commands::ai::create_draft, commands::ai::promote_suggested_due_date,
            commands::clients::list_clients, commands::clients::get_client,
            commands::clients::create_client, commands::clients::update_client,
            commands::clients::derive_from_gstin, commands::clients::set_client_file_no,
            commands::clients::import_clients_csv,
            commands::clients::set_client_credential, commands::clients::forget_client_credential,
            commands::work_items::list_work_items, commands::work_items::get_proceeding,
            commands::work_items::set_manual_due_date, commands::work_items::list_registry,
            commands::work_items::get_demand, commands::work_items::get_return, commands::work_items::get_filed_form,
            commands::ingestion::get_sweep_cadence, commands::ingestion::set_sweep_cadence,
            commands::ingestion::modules_due,
            commands::sync::get_device_info, commands::sync::export_bundle, commands::sync::peek_bundle,
            commands::sync::import_bundle, commands::sync::check_passphrase,
            commands::sync::register_firm, commands::sync::enrol_device, commands::sync::recover_admin,
            commands::sync::list_devices, commands::sync::create_invite, commands::sync::set_collector,
            commands::sync::remove_device, commands::sync::transfer_admin, commands::sync::get_sync_state,
            commands::sync::sync_now, commands::sync::leave_firm,
            commands::export::export_excel, commands::export::export_preview,
            commands::documents::open_document, commands::documents::save_document_as,
            commands::documents::get_document_base64,
            commands::ingestion::start_ingestion_run, commands::ingestion::resume_ingestion_sweep,
            commands::ingestion::refresh_client, commands::ingestion::pause_ingestion_run,
            commands::ingestion::resume_ingestion_run, commands::ingestion::stop_ingestion_run,
            commands::ingestion::get_ingestion_state, commands::ingestion::submit_login_challenge,
            commands::ingestion::set_ingestion_pace, commands::ingestion::list_ingestion_jobs,
            commands::ingestion::list_ingestion_runs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}
