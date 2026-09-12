//! One error type at the command boundary (docs/08-api-contract.md): a stable
//! `code`, a human `message`, and an optional `detail`. Module-level errors
//! converge here with `From` impls.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error, Serialize)]
#[serde(tag = "code", rename_all = "snake_case")]
pub enum AppError {
    #[error("{message}")]
    NotFound { message: String },
    #[error("{message}")]
    Invalid { message: String, #[serde(skip_serializing_if = "Option::is_none")] detail: Option<String> },
    #[error("{message}")]
    Database { message: String },
    #[error("{message}")]
    Keychain { message: String },
    #[error("{message}")]
    Sidecar { message: String },
    #[error("{message}")]
    Proxy { message: String },
    #[error("{message}")]
    Io { message: String },
    #[error("{message}")]
    State { message: String },
}

impl AppError {
    pub fn not_found(what: &str) -> Self {
        Self::NotFound { message: format!("{what} not found") }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid { message: message.into(), detail: None }
    }
    pub fn state(message: impl Into<String>) -> Self {
        Self::State { message: message.into() }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Database { message: e.to_string() }
    }
}

impl From<crate::migrate::MigrateError> for AppError {
    fn from(e: crate::migrate::MigrateError) -> Self {
        Self::Database { message: e.to_string() }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Io { message: e.to_string() }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::Invalid { message: "malformed JSON".into(), detail: Some(e.to_string()) }
    }
}

/// The pre-build modules return `String` errors; they are absorbed here
/// until each is rewritten.
impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::State { message }
    }
}

pub type AppResult<T> = Result<T, AppError>;
