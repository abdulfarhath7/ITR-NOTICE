use crate::commands::lock_db;
use crate::csv_import::{self, ImportPreview};
use crate::error::{AppError, AppResult};
use crate::gstin::{self, Derived};
use crate::ids::now;
use crate::keychain;
use crate::repo::model::Client;
use crate::repo::work_items::{self, ClientDetail, ClientSummary};
use crate::repo::{clients, rows};
use crate::AppState;
use serde::Deserialize;
use tauri::State;

#[tauri::command]
pub fn list_clients(state: State<AppState>, search: Option<String>) -> AppResult<Vec<ClientSummary>> {
    let con = lock_db(&state)?;
    work_items::client_summaries(&con, search.as_deref())
}

#[tauri::command]
pub fn get_client(state: State<AppState>, id: String) -> AppResult<ClientDetail> {
    let con = lock_db(&state)?;
    work_items::client_detail(&con, &id, |login_ref| {
        keychain::load_portal_password(login_ref).ok().flatten().is_some()
    })?.ok_or_else(|| AppError::not_found("client"))
}

/// What the add and edit forms send. Everything the user may type; nothing
/// the system owns (ids, timestamps).
#[derive(Debug, Deserialize)]
pub struct ClientInput {
    pub name: String,
    pub pan: String,
    pub gstin: Option<String>,
    pub client_code: Option<String>,
    pub entity_type: Option<String>,
    pub client_group: Option<String>,
    pub phone_cc: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub portal_login_ref: Option<String>,
    pub source: Option<String>,
    pub client_file_no: Option<String>,
    pub tags: Option<String>,
    /// Add-client only (docs/17 §4): also queue the full history, index
    /// only, for tonight.
    #[serde(default)]
    pub fetch_history_tonight: Option<bool>,
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn validate(input: &ClientInput) -> AppResult<(String, String)> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::invalid("name is required"));
    }
    let pan = input.pan.trim().to_ascii_uppercase();
    if !gstin::is_pan_shaped(&pan) {
        return Err(AppError::invalid("PAN must be 5 letters, 4 digits and a letter"));
    }
    if let Some(g) = clean(input.gstin.clone()) {
        let d = gstin::derive(&g).map_err(AppError::invalid)?;
        if d.pan != pan {
            return Err(AppError::invalid("PAN does not match the GSTIN"));
        }
    }
    if let Some(t) = clean(input.entity_type.clone()) {
        if !["individual", "company", "firm", "huf", "trust", "aop", "other"].contains(&t.as_str()) {
            return Err(AppError::invalid("entity type is not one of the known kinds"));
        }
    }
    if let Some(s) = clean(input.source.clone()) {
        if s != "portal" && s != "eri" {
            return Err(AppError::invalid("source must be portal or eri"));
        }
    }
    Ok((name, pan))
}

#[tauri::command]
pub fn create_client(state: State<AppState>, input: ClientInput) -> AppResult<ClientDetail> {
    let (name, pan) = validate(&input)?;
    let con = lock_db(&state)?;
    if clients::find_by_pan(&con, &pan)?.is_some() {
        return Err(AppError::invalid("a client with this PAN already exists"));
    }
    if let Some(code) = clean(input.client_code.clone()) {
        let taken: i64 = con.query_row("SELECT count(*) FROM clients WHERE client_code = ?1", [&code], |r| r.get(0))?;
        if taken > 0 {
            return Err(AppError::invalid("that client code is already in use"));
        }
    }
    let ts = now();
    let c = Client {
        sync_enabled: None, note: None, history_depth: None, history_fetched_at: None, history_note: None,
        cadence_tier: None, cadence_pinned: None, last_swept_at: None, sync_pause_reason: None,
        entity_kind: None, audit_case: None, tp_case: None, tds_deductor: None,
        id: crate::ids::new_id(),
        client_code: clean(input.client_code),
        name,
        entity_type: clean(input.entity_type).unwrap_or_else(|| clients::entity_type_from_pan(&pan).to_string()),
        pan,
        gstin: clean(input.gstin).map(|g| g.to_ascii_uppercase()),
        client_group: clean(input.client_group),
        phone_cc: clean(input.phone_cc).unwrap_or_else(|| "+91".into()),
        phone: clean(input.phone),
        email: clean(input.email),
        portal_login_ref: clean(input.portal_login_ref).map(|s| s.to_ascii_uppercase()),
        source: clean(input.source).unwrap_or_else(|| "portal".into()),
        client_file_no: clean(input.client_file_no),
        tags: clean(input.tags),
        created_at: ts.clone(), updated_at: ts,
    };
    rows::upsert(&con, "clients", &c)?;
    let id = c.id.clone();
    if input.fetch_history_tonight.unwrap_or(false) {
        let modules: Vec<String> = crate::repo::queue::MODULES.iter().map(|m| m.to_string()).collect();
        crate::repo::scopes::request_deep(&con, &crate::repo::scopes::DeepInput {
            client_id: &id, depth: "all", depth_value: None, modules: &modules, docs_policy: "index",
            mode: "tonight", requested_by: None,
        })?;
    }
    drop(con);
    get_client(state, id)
}

#[tauri::command]
pub fn update_client(state: State<AppState>, id: String, input: ClientInput) -> AppResult<ClientDetail> {
    let (name, pan) = validate(&input)?;
    let con = lock_db(&state)?;
    let existing = clients::get(&con, &id)?.ok_or_else(|| AppError::not_found("client"))?;
    if let Some(other) = clients::find_by_pan(&con, &pan)? {
        if other.id != id {
            return Err(AppError::invalid("another client already has this PAN"));
        }
    }
    if let Some(code) = clean(input.client_code.clone()) {
        let taken: i64 = con.query_row(
            "SELECT count(*) FROM clients WHERE client_code = ?1 AND id <> ?2", [&code, &id], |r| r.get(0))?;
        if taken > 0 {
            return Err(AppError::invalid("that client code is already in use"));
        }
    }
    let c = Client {
        client_code: clean(input.client_code),
        name,
        entity_type: clean(input.entity_type).unwrap_or(existing.entity_type),
        pan,
        gstin: clean(input.gstin).map(|g| g.to_ascii_uppercase()),
        client_group: clean(input.client_group),
        phone_cc: clean(input.phone_cc).unwrap_or(existing.phone_cc),
        phone: clean(input.phone),
        email: clean(input.email),
        portal_login_ref: clean(input.portal_login_ref).map(|s| s.to_ascii_uppercase()),
        source: clean(input.source).unwrap_or(existing.source),
        client_file_no: clean(input.client_file_no),
        tags: clean(input.tags),
        updated_at: now(),
        ..existing
    };
    clients::save(&con, &c)?;
    drop(con);
    get_client(state, id)
}

#[tauri::command]
pub fn derive_from_gstin(gstin: String) -> AppResult<Derived> {
    gstin::derive(&gstin).map_err(AppError::invalid)
}

#[tauri::command]
pub fn set_client_file_no(state: State<AppState>, client_id: String, value: Option<String>) -> AppResult<()> {
    let con = lock_db(&state)?;
    let mut c = clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    c.client_file_no = clean(value);
    c.updated_at = now();
    clients::save(&con, &c)
}

#[tauri::command]
pub fn import_clients_csv(state: State<AppState>, path: String, dry_run: bool) -> AppResult<ImportPreview> {
    let mut con = lock_db(&state)?;
    if dry_run {
        csv_import::preview(&con, &path)
    } else {
        csv_import::commit(&mut con, &path)
    }
}

// ------------------------------------------------------------ credentials
// The keychain entry is keyed by the login that reaches the client: its own
// PAN, or `portal_login_ref` when an AR login is used. The database never
// sees the password; the log never sees it either.

#[tauri::command]
pub fn set_client_credential(state: State<AppState>, client_id: String, password: String) -> AppResult<()> {
    if password.is_empty() {
        return Err(AppError::invalid("password is empty"));
    }
    let login_ref = {
        let con = lock_db(&state)?;
        let c = clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
        c.portal_login_ref.unwrap_or(c.pan)
    };
    keychain::save_portal_password(&login_ref, &password).map_err(|e| AppError::Keychain { message: e })
}

#[tauri::command]
pub fn forget_client_credential(state: State<AppState>, client_id: String) -> AppResult<()> {
    let login_ref = {
        let con = lock_db(&state)?;
        let c = clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
        c.portal_login_ref.unwrap_or(c.pan)
    };
    keychain::forget_portal_password(&login_ref).map_err(|e| AppError::Keychain { message: e })
}

/// Client 360 "Sync" switch (docs/16 §7): off keeps the client out of
/// whole-book and scheduled sweeps.
#[tauri::command]
pub fn set_client_sync_enabled(state: State<AppState>, client_id: String, enabled: bool) -> AppResult<()> {
    let con = lock_db(&state)?;
    let mut c = clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    c.sync_enabled = Some(i64::from(enabled));
    c.updated_at = now();
    clients::save(&con, &c)
}

/// Client 360 Notes tab: a free-text note on the client, synced with it.
#[tauri::command]
pub fn set_client_note(state: State<AppState>, client_id: String, note: String) -> AppResult<()> {
    let con = lock_db(&state)?;
    let mut c = clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    c.note = Some(note);
    c.updated_at = now();
    clients::save(&con, &c)
}

// ------------------------------------------------------------ delete

/// What deleting a client would remove, for the confirmation dialog.
#[tauri::command]
pub fn client_delete_preview(state: State<AppState>, client_id: String) -> AppResult<crate::repo::client_delete::DeletePreview> {
    let con = lock_db(&state)?;
    crate::repo::client_delete::preview(&con, &client_id)
}

/// Delete a client and everything under it, here and — through the
/// ledger — on every device of the firm. Refused while a run is in flight
/// so the runner never writes under a client that is gone.
#[tauri::command]
pub fn delete_client(state: State<AppState>, client_id: String) -> AppResult<()> {
    if crate::commands::ingestion::busy(&state) {
        return Err(AppError::state("a sweep is running; delete the client when it finishes"));
    }
    let (login, shared) = {
        let mut con = lock_db(&state)?;
        crate::repo::client_delete::delete(&mut con, &client_id)?
    };
    // The keychain entry belongs to the login; keep it while another
    // client still signs in with it.
    if !shared {
        let _ = keychain::forget_portal_password(&login);
    }
    Ok(())
}
