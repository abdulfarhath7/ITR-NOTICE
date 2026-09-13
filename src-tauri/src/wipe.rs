//! Best-effort remote wipe (task 12.9, Q16). When the relay says this
//! device was removed, the device hands over the entries it still holds,
//! then deletes its archive, document store and keychain entries and shows
//! a plain "removed" screen on every launch after that.
//!
//! Best effort means exactly this: it happens only if the device comes
//! online and the app is opened. A disk image, or a machine that never
//! reconnects, is untouched — the admin dialog says so.

use crate::error::{AppError, AppResult};
use crate::repo::clients;
use crate::AppState;
use rusqlite::Connection;

pub const FLAG_FILE: &str = "removed.flag";

/// Did the relay tell us we are removed?
pub fn is_removed_error(e: &AppError) -> bool {
    matches!(e, AppError::Proxy { message } if message.contains("403") && message.contains("removed"))
}

pub fn removed_flag(data_dir: &std::path::Path) -> bool {
    data_dir.join(FLAG_FILE).exists()
}

/// Push what we can, then destroy. The connection in `state` is replaced
/// by an empty in-memory database so the running app stays consistent
/// until it is closed.
pub async fn perform(state: &AppState) -> AppResult<()> {
    // 1. hand over pending entries — the relay accepts a removed device's
    //    final push and nothing else
    let _ = crate::sync::push_only(&state.db).await;

    let data_dir = state.settings_path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let logins: Vec<String> = {
        let con = state.db.lock().map_err(|e| AppError::state(e.to_string()))?;
        clients::list(&con)?.into_iter().map(|c| c.portal_login_ref.unwrap_or(c.pan)).collect()
    };
    // 2. keychain: portal passwords, firm key, signing key, archive key
    for login in logins { let _ = crate::keychain::forget_portal_password(&login); }
    let _ = crate::keychain::forget_secret(crate::relay::FIRM_KEY);
    let _ = crate::keychain::forget_secret("device-signing-key");
    let _ = crate::keychain::forget_secret("archive-key");
    let _ = crate::keychain::forget_secret(crate::keychain::FIRM_TOKEN);
    // 3. the archive and documents (one file), the viewer scratch, settings
    {
        let mut guard = state.db.lock().map_err(|e| AppError::state(e.to_string()))?;
        let empty = Connection::open_in_memory()?;
        let old = std::mem::replace(&mut *guard, empty);
        drop(old);
    }
    for name in ["archive.db", "archive.db-wal", "archive.db-shm", "settings.json"] {
        let _ = std::fs::remove_file(data_dir.join(name));
    }
    let _ = std::fs::remove_dir_all(&state.temp_dir);
    let _ = std::fs::remove_dir_all(data_dir.join("debug"));
    // 4. the flag every later launch reads
    std::fs::write(data_dir.join(FLAG_FILE), "removed by the firm's admin\n")?;
    Ok(())
}

/// Ask the relay whether we still belong; called by the scheduler tick
/// every ten minutes and by every sync. `Ok(true)` means removed.
pub async fn check(state: &AppState) -> AppResult<bool> {
    let cfg = {
        let con = state.db.lock().map_err(|e| AppError::state(e.to_string()))?;
        match crate::relay::config(&con)? { Some(c) => c, None => return Ok(false) }
    };
    match crate::relay::Relay::new(cfg).lease().await {
        Ok(_) => Ok(false),
        Err(e) if is_removed_error(&e) => Ok(true),
        Err(_) => Ok(false),   // unreachable is not removed
    }
}

