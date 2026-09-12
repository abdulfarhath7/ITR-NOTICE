mod backfill;
mod claude;
mod dates;
mod db;
mod error;
mod ids;
mod intake;
mod keychain;
mod migrate;
mod repo;
mod scraper;

use claude::{DraftAnswer, DueDateAnswer, Proxy};
use db::{Draft, NoticeRow};
use rusqlite::Connection;
use scraper::Scraper;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex as AsyncMutex;

pub struct AppState {
    db: Arc<Mutex<Connection>>,
    scraper: AsyncMutex<Option<Scraper>>,
    settings_path: std::path::PathBuf,
}

type R<T> = Result<T, String>;

fn lock_db(state: &AppState) -> R<std::sync::MutexGuard<'_, Connection>> {
    state.db.lock().map_err(|e| e.to_string())
}

// ------------------------------------------------------------ settings

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

fn read_settings(state: &AppState) -> Settings {
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

fn write_settings(state: &AppState, settings: Settings) -> R<()> {
    keychain::save_secret(keychain::FIRM_TOKEN, &settings.firm_token)?;
    let on_disk = Settings { firm_token: String::new(), ..settings };
    std::fs::write(&state.settings_path, serde_json::to_string_pretty(&on_disk).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> R<Settings> {
    Ok(read_settings(&state))
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: Settings) -> R<()> {
    write_settings(&state, settings)
}

fn proxy(state: &AppState) -> R<Proxy> {
    let s = read_settings(state);
    if s.firm_token.is_empty() {
        return Err("add your firm token in Settings first".into());
    }
    Ok(Proxy { base_url: s.proxy_url, firm_token: s.firm_token })
}

// ------------------------------------------------------------ archive

#[tauri::command]
fn list_notices(state: State<AppState>) -> R<Vec<NoticeRow>> {
    let con = lock_db(&state)?;
    db::list_notices(&con)
}

/// Base64 so the webview can build a blob: URL and show it in an <iframe>.
#[tauri::command]
fn get_notice_pdf(state: State<AppState>, ref_id: String) -> R<String> {
    use base64::Engine;
    let con = lock_db(&state)?;
    let pdf = db::get_pdf(&con, &ref_id)?.ok_or("no PDF stored for this notice")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(pdf))
}

#[tauri::command]
fn get_draft(state: State<AppState>, ref_id: String) -> R<Option<Draft>> {
    let con = lock_db(&state)?;
    db::get_draft(&con, &ref_id)
}

#[tauri::command]
fn save_draft_text(state: State<AppState>, ref_id: String, draft_text: String) -> R<()> {
    let con = lock_db(&state)?;
    db::update_draft_text(&con, &ref_id, &draft_text)
}

// ------------------------------------------------------------ credentials

#[tauri::command]
fn has_saved_password(user_id: String) -> R<bool> {
    Ok(keychain::load_portal_password(&user_id)?.is_some())
}

#[tauri::command]
fn forget_password(user_id: String) -> R<()> {
    keychain::forget_portal_password(&user_id)
}

// ------------------------------------------------------------ portal

async fn ensure_scraper(app: &AppHandle, state: &AppState) -> R<()> {
    let mut guard = state.scraper.lock().await;
    if guard.is_none() {
        *guard = Some(Scraper::spawn(app.clone(), state.db.clone()).await?);
    }
    Ok(())
}

/// password = None means "use the one in the keychain".
#[tauri::command]
async fn portal_login(app: AppHandle, state: State<'_, AppState>, user_id: String,
                      password: Option<String>, remember: bool) -> R<()> {
    let pw = match password {
        Some(p) if !p.is_empty() => {
            if remember { keychain::save_portal_password(&user_id, &p)?; }
            p
        }
        _ => keychain::load_portal_password(&user_id)?
            .ok_or("no saved password for this user id - type it in")?,
    };
    // remember the user id (not secret) for next launch
    let mut s = read_settings(&state);
    s.last_user_id = user_id.clone();
    s.remember_password = remember;
    let _ = write_settings(&state, s);

    ensure_scraper(&app, &state).await?;
    let mut guard = state.scraper.lock().await;
    guard.as_mut().unwrap()
        .send(json!({"cmd": "login", "user_id": user_id, "password": pw})).await
}

#[tauri::command]
async fn portal_otp(state: State<'_, AppState>, code: String) -> R<()> {
    let mut guard = state.scraper.lock().await;
    guard.as_mut().ok_or("not logged in")?.send(json!({"cmd": "otp", "code": code})).await
}

#[tauri::command]
async fn portal_sync(state: State<'_, AppState>, limit: Option<u32>) -> R<()> {
    let mut guard = state.scraper.lock().await;
    guard.as_mut().ok_or("log in first")?.send(json!({"cmd": "sync", "limit": limit})).await
}

#[tauri::command]
async fn portal_speed(state: State<'_, AppState>, seconds: f64) -> R<()> {
    let mut guard = state.scraper.lock().await;
    if let Some(s) = guard.as_mut() {
        s.send(json!({"cmd": "speed", "seconds": seconds})).await?;
    }
    Ok(())
}

#[tauri::command]
async fn portal_stop(state: State<'_, AppState>) -> R<()> {
    if let Some(s) = state.scraper.lock().await.take() {
        s.stop().await;
    }
    Ok(())
}

// ------------------------------------------------------------ Claude

#[tauri::command]
async fn ask_due_date(state: State<'_, AppState>, ref_id: String) -> R<DueDateAnswer> {
    let (row, pdf) = {
        let con = lock_db(&state)?;
        let row = db::get_notice(&con, &ref_id)?.ok_or("no such notice")?;
        let pdf = db::get_pdf(&con, &ref_id)?;
        (row, pdf)
    };
    // Cache rule from the web tool: a stored date is the truth. A portal
    // date is never overwritten; a Claude date is never asked for twice.
    if let Some(d) = row.due_date.clone() {
        return Ok(DueDateAnswer { due_date: Some(d), basis: row.due_date_basis });
    }
    let pdf = pdf.ok_or("no PDF stored yet - run a sync first")?;
    let ans = proxy(&state)?
        .due_date(&ref_id, &pdf, row.issued_on.as_deref(), row.served_on.as_deref()).await?;
    if let Some(d) = ans.due_date.as_deref() {
        let con = lock_db(&state)?;
        db::set_claude_due_date(&con, &ref_id, d, ans.basis.as_deref())?;
    }
    Ok(ans)
}

#[tauri::command]
async fn draft_response(state: State<'_, AppState>, ref_id: String, regenerate: bool) -> R<Draft> {
    let (row, pdf, existing) = {
        let con = lock_db(&state)?;
        (db::get_notice(&con, &ref_id)?.ok_or("no such notice")?,
         db::get_pdf(&con, &ref_id)?,
         db::get_draft(&con, &ref_id)?)
    };
    if let (Some(d), false) = (existing, regenerate) {
        return Ok(d);
    }
    let pdf = pdf.ok_or("no PDF stored yet - run a sync first")?;
    let a: DraftAnswer = proxy(&state)?
        .draft(&ref_id, &pdf, row.notice_us.as_deref(), row.assessee_name.as_deref(),
               row.assessment_year.as_deref()).await?;
    let d = Draft { ref_id: ref_id.clone(), generated_at: None,
                    summary: a.summary, checklist: a.checklist, draft_text: a.draft_reply };
    let con = lock_db(&state)?;
    db::save_draft(&con, &d)?;
    db::get_draft(&con, &ref_id)?.ok_or("draft vanished".into())
}

// ------------------------------------------------------------ setup

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let key = keychain::db_key()?;
            let con = db::open(&data_dir.join("archive.db"), &key)?;
            app.manage(AppState {
                db: Arc::new(Mutex::new(con)),
                scraper: AsyncMutex::new(None),
                settings_path: data_dir.join("settings.json"),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings,
            list_notices, get_notice_pdf, get_draft, save_draft_text,
            has_saved_password, forget_password,
            portal_login, portal_otp, portal_sync, portal_speed, portal_stop,
            ask_due_date, draft_response,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Litigation Command Center");
}
