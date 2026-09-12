//! The legacy single-account portal flow: login, OTP, sync, speed, stop.
//! Replaced by the ingestion service in Phase 4; kept working until then.

use crate::commands::settings::{read_settings, write_settings};
use crate::error::{AppError, AppResult};
use crate::keychain;
use crate::scraper::Scraper;
use crate::AppState;
use serde_json::json;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn has_saved_password(user_id: String) -> AppResult<bool> {
    Ok(keychain::load_portal_password(&user_id).map_err(|e| AppError::Keychain { message: e })?.is_some())
}

#[tauri::command]
pub fn forget_password(user_id: String) -> AppResult<()> {
    keychain::forget_portal_password(&user_id).map_err(|e| AppError::Keychain { message: e })
}

async fn ensure_scraper(app: &AppHandle, state: &AppState) -> AppResult<()> {
    let mut guard = state.scraper.lock().await;
    if guard.is_none() {
        *guard = Some(Scraper::spawn(app.clone(), state.db.clone()).await
            .map_err(|e| AppError::Sidecar { message: e })?);
    }
    Ok(())
}

/// password = None means "use the one in the keychain". The value is never
/// logged and never stored unless `remember` is set.
#[tauri::command]
pub async fn portal_login(app: AppHandle, state: State<'_, AppState>, user_id: String,
                          password: Option<String>, remember: bool) -> AppResult<()> {
    let pw = match password {
        Some(p) if !p.is_empty() => {
            if remember { keychain::save_portal_password(&user_id, &p).map_err(|e| AppError::Keychain { message: e })?; }
            p
        }
        _ => keychain::load_portal_password(&user_id).map_err(|e| AppError::Keychain { message: e })?
            .ok_or_else(|| AppError::state("no saved password for this user id - type it in"))?,
    };
    // remember the user id (not secret) for next launch
    let mut s = read_settings(&state);
    s.last_user_id = user_id.clone();
    s.remember_password = remember;
    let _ = write_settings(&state, s);

    ensure_scraper(&app, &state).await?;
    let mut guard = state.scraper.lock().await;
    let scraper = guard.as_mut().ok_or_else(|| AppError::Sidecar { message: "sidecar did not start".into() })?;
    scraper.set_login_pan(&user_id);
    scraper.send(json!({"cmd": "login", "user_id": user_id, "password": pw})).await
        .map_err(|e| AppError::Sidecar { message: e })
}

#[tauri::command]
pub async fn portal_otp(state: State<'_, AppState>, code: String) -> AppResult<()> {
    let mut guard = state.scraper.lock().await;
    guard.as_mut().ok_or_else(|| AppError::state("not logged in"))?
        .send(json!({"cmd": "otp", "code": code})).await.map_err(|e| AppError::Sidecar { message: e })
}

#[tauri::command]
pub async fn portal_sync(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<()> {
    let mut guard = state.scraper.lock().await;
    guard.as_mut().ok_or_else(|| AppError::state("log in first"))?
        .send(json!({"cmd": "sync", "limit": limit})).await.map_err(|e| AppError::Sidecar { message: e })
}

#[tauri::command]
pub async fn portal_speed(state: State<'_, AppState>, seconds: f64) -> AppResult<()> {
    let mut guard = state.scraper.lock().await;
    if let Some(s) = guard.as_mut() {
        s.send(json!({"cmd": "speed", "seconds": seconds})).await.map_err(|e| AppError::Sidecar { message: e })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn portal_stop(state: State<'_, AppState>) -> AppResult<()> {
    if let Some(s) = state.scraper.lock().await.take() {
        s.stop().await;
    }
    Ok(())
}
