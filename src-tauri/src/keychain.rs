//! Secrets go to the OS keychain (Windows Credential Manager / macOS Keychain /
//! Secret Service). Three of them:
//!   - the SQLCipher key for the archive (generated once, per machine)
//!   - the portal password, keyed by the portal user id (PAN), opt-in
//!   - the firm's proxy bearer token

use keyring::Entry;
use rand::RngCore;

const SERVICE: &str = "in.lcc.app";
/// The identifier before the LCC/LLC typo was fixed (Q21). Secrets stored
/// under it are copied forward on first use, never read again after that.
const OLD_SERVICE: &str = "in.llc.app";

fn e(err: impl std::fmt::Display) -> String {
    err.to_string()
}

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(e)
}

pub fn save_secret(name: &str, value: &str) -> Result<(), String> {
    entry(name)?.set_password(value).map_err(e)
}

pub fn load_secret(name: &str) -> Result<Option<String>, String> {
    match entry(name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => {
            // One-time carry-over from the old service name.
            match Entry::new(OLD_SERVICE, name).map_err(e)?.get_password() {
                Ok(v) => { save_secret(name, &v)?; Ok(Some(v)) }
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(err) => Err(e(err)),
            }
        }
        Err(err) => Err(e(err)),
    }
}

pub fn forget_secret(name: &str) -> Result<(), String> {
    match entry(name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(e(err)),
    }
}

/// 32 random bytes as hex. Created on first launch; a machine that loses
/// its keychain loses the archive - say so in onboarding.
pub fn db_key() -> Result<String, String> {
    if let Some(k) = load_secret("archive-key")? {
        if k.len() == 64 { return Ok(k); }
    }
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    let k = hex::encode(bytes);
    save_secret("archive-key", &k)?;
    Ok(k)
}

fn portal_name(user_id: &str) -> String {
    format!("portal:{}", user_id.trim().to_uppercase())
}

pub fn save_portal_password(user_id: &str, password: &str) -> Result<(), String> {
    save_secret(&portal_name(user_id), password)
}
pub fn load_portal_password(user_id: &str) -> Result<Option<String>, String> {
    load_secret(&portal_name(user_id))
}
pub fn forget_portal_password(user_id: &str) -> Result<(), String> {
    forget_secret(&portal_name(user_id))
}

pub const FIRM_TOKEN: &str = "firm-token";
