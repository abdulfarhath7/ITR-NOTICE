//! Proxy URL and firm token; the token lives in the keychain.

use crate::error::AppResult;
use crate::keychain;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct Settings {
    pub proxy_url: String,
    /// Not persisted here - lives in the keychain. Present in the struct so
    /// the settings form is one object in and out.
    #[serde(default)]
    pub firm_token: String,
    pub remember_password: bool,
    pub last_user_id: String,
}

pub fn read_settings(state: &AppState) -> Settings {
    let mut s: Settings = std::fs::read_to_string(&state.settings_path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if s.proxy_url.is_empty() {
        s.proxy_url = "http://localhost:8787".into();
    }
    s.firm_token = keychain::load_secret(keychain::FIRM_TOKEN).ok().flatten().unwrap_or_default();
    s
}

pub fn write_settings(state: &AppState, settings: Settings) -> Result<(), String> {
    keychain::save_secret(keychain::FIRM_TOKEN, &settings.firm_token)?;
    let on_disk = Settings { firm_token: String::new(), ..settings };
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
