//! Proxy URL and firm token; the token lives in the keychain.

use crate::error::AppResult;
use crate::keychain;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Settings {
    pub proxy_url: String,
    /// Not persisted here - lives in the keychain. Present in the struct so
    /// the settings form is one object in and out.
    #[serde(default)]
    pub firm_token: String,
    pub remember_password: bool,
    pub last_user_id: String,
    /// Text size in percent (docs/16 §2.4). One of `UI_SCALES`; anything
    /// else read from disk is clamped to the nearest allowed value.
    #[serde(default = "default_scale")]
    pub ui_scale: u8,
    /// docs/18 §4.1 (Q54): the export dialog's column picker, remembered
    /// per device. None = every column. The dialog is the one reader and
    /// writer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_columns: Option<Vec<String>>,
}

pub const UI_SCALES: [u8; 5] = [85, 92, 100, 112, 125];

fn default_scale() -> u8 { 100 }

impl Default for Settings {
    fn default() -> Self {
        Settings { proxy_url: String::new(), firm_token: String::new(), remember_password: false,
                   last_user_id: String::new(), ui_scale: default_scale(), export_columns: None }
    }
}

/// The allowed scale nearest to `v`; ties go to the smaller.
pub fn clamp_scale(v: u8) -> u8 {
    *UI_SCALES.iter().min_by_key(|s| (i16::from(**s) - i16::from(v)).abs()).unwrap_or(&100)
}

pub fn read_settings(state: &AppState) -> Settings {
    let mut s: Settings = std::fs::read_to_string(&state.settings_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if s.proxy_url.is_empty() {
        s.proxy_url = "http://localhost:8787".into();
    }
    s.ui_scale = clamp_scale(s.ui_scale);
    s.firm_token = keychain::load_secret(keychain::FIRM_TOKEN).ok().flatten().unwrap_or_default();
    s
}

pub fn write_settings(state: &AppState, settings: Settings) -> Result<(), String> {
    keychain::save_secret(keychain::FIRM_TOKEN, &settings.firm_token)?;
    let on_disk = Settings { firm_token: String::new(), ui_scale: clamp_scale(settings.ui_scale), ..settings };
    std::fs::write(&state.settings_path, serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AppResult<Settings> {
    Ok(read_settings(&state))
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> AppResult<()> {
    write_settings(&state, settings).map_err(|e| crate::error::AppError::Keychain { message: e })
}

#[derive(Debug, Serialize)]
pub struct DataDirInfo {
    pub path: String,
    pub archive_bytes: u64,
}

#[tauri::command]
pub fn get_data_dir(state: State<AppState>) -> AppResult<DataDirInfo> {
    let dir = state.settings_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let archive_bytes = std::fs::metadata(dir.join("archive.db")).map(|m| m.len()).unwrap_or(0);
    Ok(DataDirInfo { path: dir.to_string_lossy().to_string(), archive_bytes })
}

#[tauri::command]
pub fn open_data_dir(app: tauri::AppHandle, state: State<AppState>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = state.settings_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    app.opener().open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| crate::error::AppError::Io { message: e.to_string() })
}

#[derive(Debug, Serialize)]
pub struct SetupState {
    pub done: bool,
    pub relay_configured: bool,
    pub permission: Option<String>,
    pub client_count: i64,
    /// The admin removed this device; the local book was wiped (Q16).
    pub removed: bool,
}

/// The first-run wizard shows until it is finished once (or skipped).
#[tauri::command]
pub fn get_setup_state(state: State<AppState>) -> AppResult<SetupState> {
    let con = crate::commands::lock_db(&state)?;
    // After a wipe the connection is an empty in-memory database; every
    // read below tolerates that.
    let done = crate::repo::local::get(&con, "setup_done").unwrap_or(None).as_deref() == Some("1");
    let relay_configured = crate::relay::config(&con).unwrap_or(None).is_some();
    let permission = crate::repo::local::get(&con, crate::relay::KEY_PERMISSION).unwrap_or(None);
    let client_count: i64 = con.query_row("SELECT count(*) FROM clients", [], |r| r.get(0)).unwrap_or(0);
    let data_dir = state.settings_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    Ok(SetupState { done, relay_configured, permission, client_count, removed: crate::wipe::removed_flag(&data_dir) })
}

#[tauri::command]
pub fn mark_setup_done(state: State<AppState>) -> AppResult<()> {
    let con = crate::commands::lock_db(&state)?;
    crate::repo::local::set(&con, "setup_done", "1")
}
