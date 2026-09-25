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
mod wipe;

use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub settings_path: std::path::PathBuf,
    /// Unencrypted scratch for documents handed to the OS viewer; cleared
    /// on every launch.
    pub temp_dir: std::path::PathBuf,
    pub ingestion: commands::ingestion::IngestionService,
}

/// The bundle identifier changed from `in.llc.app` to `in.lcc.app` (Q21).
/// An archive written under the old folder is moved into the new one the
/// first time the new build runs, so nothing is orphaned.
fn carry_over_old_data_dir(new_dir: &std::path::Path) {
    let Some(parent) = new_dir.parent() else { return; };
    let old_dir = parent.join("in.llc.app");
    if !old_dir.join("archive.db").exists() || new_dir.join("archive.db").exists() { return; }
    for name in ["archive.db", "archive.db-wal", "archive.db-shm", "settings.json"] {
        let (from, to) = (old_dir.join(name), new_dir.join(name));
        if from.exists() { let _ = std::fs::rename(&from, &to).or_else(|_| std::fs::copy(&from, &to).map(|_| ())); }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            carry_over_old_data_dir(&data_dir);
            // A removed device opens an empty in-memory book and shows the
            // removed screen; it never recreates the archive on its own.
            let con = if wipe::removed_flag(&data_dir) {
                rusqlite::Connection::open_in_memory()?
            } else {
                let key = keychain::db_key()?;
                db::open(&data_dir.join("archive.db"), &key)?
            };
            let temp_dir = data_dir.join("viewer-temp");
            commands::documents::clear_temp(&temp_dir);
            app.manage(AppState {
                db: Arc::new(Mutex::new(con)),
                settings_path: data_dir.join("settings.json"),
                temp_dir,
                ingestion: commands::ingestion::IngestionService::default(),
            });
            ingest::scheduler::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings, commands::settings::save_settings,
            commands::settings::get_data_dir, commands::settings::open_data_dir,
            commands::settings::get_setup_state, commands::settings::mark_setup_done,
            commands::ai::get_draft, commands::ai::save_draft_text,
            commands::ai::suggest_due_date, commands::ai::create_draft, commands::ai::promote_suggested_due_date,
            commands::clients::list_clients, commands::clients::get_client,
            commands::clients::create_client, commands::clients::update_client,
            commands::clients::derive_from_gstin, commands::clients::set_client_file_no,
            commands::clients::import_clients_csv,
            commands::clients::set_client_sync_enabled, commands::clients::set_client_note, commands::clients::client_delete_preview, commands::clients::delete_client,
            commands::work_items::set_limitation_date,
            commands::clients::set_client_credential, commands::clients::forget_client_credential,
            commands::work_items::list_work_items, commands::work_items::get_proceeding,
            commands::work_items::set_manual_due_date, commands::work_items::list_registry,
            commands::work_items::get_demand, commands::work_items::get_return, commands::work_items::get_filed_form,
            commands::work_items::get_work_item_meta, commands::work_items::set_work_item_meta,
            commands::work_items::list_assignees, commands::ai::set_draft_reviewed,
            commands::ingestion::get_sweep_cadence, commands::ingestion::set_sweep_cadence,
            commands::ingestion::modules_due,
            commands::ingestion::get_sweep_schedule, commands::ingestion::set_sweep_schedule,
            commands::sync::get_device_info, commands::sync::export_bundle, commands::sync::peek_bundle,
            commands::sync::import_bundle, commands::sync::check_passphrase,
            commands::sync::register_firm, commands::sync::enrol_device, commands::sync::recover_admin,
            commands::sync::list_devices, commands::sync::create_invite, commands::sync::set_collector,
            commands::sync::remove_device, commands::sync::transfer_admin, commands::sync::get_sync_state,
            commands::sync::sync_now, commands::sync::leave_firm,
            commands::sync::set_alert_email, commands::sync::get_alert_email,
            commands::export::export_excel, commands::export::export_preview, commands::export::export_updates,
            commands::export::preview_export_sheet, commands::export::export_columns,
            commands::export::export_clients, commands::export::clients_export_name,
            commands::export::export_sweep_run, commands::export::sweep_run_export_name, commands::scopes::deep_probe_info,
            commands::documents::open_document, commands::documents::save_document_as,
            commands::documents::get_document_base64,
            commands::ingestion::start_ingestion_run, commands::ingestion::resume_ingestion_sweep,
            commands::ingestion::refresh_client, commands::ingestion::pause_ingestion_run,
            commands::ingestion::resume_ingestion_run, commands::ingestion::stop_ingestion_run,
            commands::ingestion::get_ingestion_state, commands::ingestion::submit_login_challenge,
            commands::ingestion::set_ingestion_pace, commands::ingestion::list_ingestion_jobs,
            commands::ingestion::list_ingestion_runs, commands::ingestion::get_sync_line, commands::ingestion::list_updates,
            commands::scopes::request_deep_fetch, commands::scopes::cancel_deep_fetch, commands::scopes::retry_deep_fetch,
            commands::scopes::list_deep_fetch_requests, commands::scopes::fetch_item, commands::scopes::sweep_estimate,
            commands::scopes::deep_estimate, commands::scopes::get_sweep_settings, commands::scopes::set_sweep_settings,
            commands::scopes::set_client_sync, commands::scopes::pin_client_cadence, commands::scopes::get_sync_overview,
            commands::scopes::get_last_sweep_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the desktop app");
}
