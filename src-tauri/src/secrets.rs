//! Secrets live in the OS keychain (Windows Credential Manager), never in a
//! file this app writes.
//!
//! The default is deliberately *not* to store anything: "ask each time" keeps
//! the portal login in the sidecar's memory for one run, which is the property
//! the backend was built around. Storing is opt-in, one secret at a time.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "notice-desk";

/// The three things worth keeping between runs. The portal password is
/// included but off by default - see `Slot::PortalPassword`.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Slot {
    /// Gate for the sidecar itself (APP_PASSWORD).
    AppPassword,
    /// The LLM key (ANTHROPIC_API_KEY).
    LlmKey,
    /// Portal user id. Opt-in.
    PortalUserId,
    /// Portal password. Opt-in, and never injected unless the user asked for
    /// it to be remembered.
    PortalPassword,
}

impl Slot {
    fn key(self) -> &'static str {
        match self {
            Slot::AppPassword => "app_password",
            Slot::LlmKey => "llm_key",
            Slot::PortalUserId => "portal_user_id",
            Slot::PortalPassword => "portal_password",
        }
    }

    /// The environment variable the sidecar reads this as, if any.
    pub fn env_name(self) -> Option<&'static str> {
        match self {
            Slot::AppPassword => Some("APP_PASSWORD"),
            Slot::LlmKey => Some("ANTHROPIC_API_KEY"),
            Slot::PortalUserId | Slot::PortalPassword => None,
        }
    }
}

fn entry(slot: Slot) -> Result<Entry, String> {
    Entry::new(SERVICE, slot.key()).map_err(|error| error.to_string())
}

pub fn set(slot: Slot, value: &str) -> Result<(), String> {
    entry(slot)?
        .set_password(value)
        .map_err(|error| error.to_string())
}

pub fn get(slot: Slot) -> Result<Option<String>, String> {
    match entry(slot)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

pub fn delete(slot: Slot) -> Result<(), String> {
    match entry(slot)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

/// Which slots are filled. The values themselves never cross this boundary -
/// the UI only ever needs to know whether something is remembered.
#[derive(Debug, Serialize)]
pub struct SecretStatus {
    pub app_password: bool,
    pub llm_key: bool,
    pub portal_user_id: bool,
    pub portal_password: bool,
}

pub fn status() -> SecretStatus {
    let filled = |slot: Slot| get(slot).ok().flatten().is_some();
    SecretStatus {
        app_password: filled(Slot::AppPassword),
        llm_key: filled(Slot::LlmKey),
        portal_user_id: filled(Slot::PortalUserId),
        portal_password: filled(Slot::PortalPassword),
    }
}

/// What the sidecar is spawned with. Only the slots that map to an environment
/// variable are injected; the portal login is typed into the running app and
/// stays in the backend's memory, exactly as it does on the web.
pub fn environment() -> std::collections::HashMap<String, String> {
    let mut env = std::collections::HashMap::new();
    for slot in [Slot::AppPassword, Slot::LlmKey] {
        if let (Some(name), Ok(Some(value))) = (slot.env_name(), get(slot)) {
            if !value.is_empty() {
                env.insert(name.to_string(), value);
            }
        }
    }
    env
}
