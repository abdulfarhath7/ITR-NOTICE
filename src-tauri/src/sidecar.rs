//! The Python backend, owned by the shell.
//!
//! One process, on loopback, on a port nobody else holds, behind a token that
//! exists only for this launch. The window is not shown until `GET /health`
//! answers; the process is killed when the app exits, and never left orphaned.

use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// How long the shell waits for the sidecar to answer /health before it gives
/// up and shows the failure. First run installs Chromium, which is slow, but
/// that happens after the server is already listening.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(45);
const HEALTH_INTERVAL: Duration = Duration::from_millis(250);

/// What the UI is told: where the sidecar is, and the token that opens it.
/// Nothing here is ever written to disk.
#[derive(Clone, Debug, Serialize)]
pub struct BackendInfo {
    pub base_url: String,
    pub token: String,
}

#[derive(Default)]
pub struct SidecarState {
    pub info: Mutex<Option<BackendInfo>>,
    /// Why the backend never came up. Kept here as well as emitted, because an
    /// event fired during setup can beat the webview's listener.
    pub failure: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
}

impl SidecarState {
    pub fn info(&self) -> Option<BackendInfo> {
        self.info.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn failure(&self) -> Option<String> {
        self.failure.lock().ok().and_then(|guard| guard.clone())
    }

    pub fn set_failure(&self, message: String) {
        if let Ok(mut guard) = self.failure.lock() {
            *guard = Some(message);
        }
    }

    /// Called on exit and on window close. Killing twice is fine.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("no free loopback port: {0}")]
    NoPort(std::io::Error),
    #[error("could not start the backend: {0}")]
    Spawn(String),
    #[error("the backend did not become ready in {0} seconds")]
    Timeout(u64),
    #[error("the backend stopped before it was ready")]
    Died,
}

/// Anything that looks like the shared token in a line the sidecar printed.
/// The comment used to claim these lines never carry a credential; the
/// websocket's `?token=` fallback means they can, so they are scrubbed.
fn redact(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find("token=") {
        out.push_str(&rest[..at + "token=".len()]);
        out.push_str("<redacted>");
        rest = &rest[at + "token=".len()..];
        let end = rest
            .find(|c: char| c == '&' || c.is_whitespace() || c == '"' || c == '\'')
            .unwrap_or(rest.len());
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

fn free_port() -> Result<u16, SidecarError> {
    // Bind :0, read what the OS handed out, then drop the listener. A tiny
    // race with another process is possible and harmless: the sidecar simply
    // fails to bind and the error surfaces at once.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(SidecarError::NoPort)?;
    let port = listener
        .local_addr()
        .map_err(SidecarError::NoPort)?
        .port();
    Ok(port)
}

fn mint_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

/// Spawn the bundled `notice-desk-backend`, wait for it to answer, and return
/// how to reach it.
///
/// `secrets` carries anything the keychain gave us (APP_PASSWORD,
/// ANTHROPIC_API_KEY). It is passed straight into the child's environment and
/// never logged.
pub async fn start(
    app: &AppHandle,
    secrets: HashMap<String, String>,
) -> Result<BackendInfo, SidecarError> {
    {
        // Never two backends against one database file.
        let state = app.state::<SidecarState>();
        let running = state
            .child
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        if running {
            if let Some(info) = state.info() {
                return Ok(info);
            }
        }
    }

    let port = free_port()?;
    let token = mint_token();

    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("NoticeDesk"));
    let _ = std::fs::create_dir_all(&data_dir);

    let mut command = app
        .shell()
        .sidecar("notice-desk-backend")
        .map_err(|error| SidecarError::Spawn(error.to_string()))?
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("APP_TOKEN", &token)
        .env("NOTICE_DESK_DATA_DIR", data_dir.to_string_lossy().to_string())
        .env("PYTHONUNBUFFERED", "1");

    for (key, value) in secrets {
        command = command.env(key, value);
    }

    let (mut events, child) = command
        .spawn()
        .map_err(|error| SidecarError::Spawn(error.to_string()))?;

    // Set the moment the child exits, so the health wait fails at once instead
    // of counting out the full timeout against a process that is already gone.
    let died = Arc::new(AtomicBool::new(false));
    let died_writer = died.clone();

    {
        let state = app.state::<SidecarState>();
        if let Ok(mut guard) = state.child.lock() {
            *guard = Some(child);
        }
    }

    // The sidecar's stdout is the only place its first-run Chromium install
    // reports progress, so it is worth keeping in the app log - scrubbed,
    // because a websocket request line can carry ?token=.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    log::info!("[sidecar] {}", redact(String::from_utf8_lossy(&line).trim_end()));
                }
                CommandEvent::Terminated(status) => {
                    log::warn!("[sidecar] exited: {status:?}");
                    died_writer.store(true, Ordering::SeqCst);
                    break;
                }
                CommandEvent::Error(message) => {
                    log::error!("[sidecar] {}", redact(&message));
                    died_writer.store(true, Ordering::SeqCst);
                    break;
                }
                _ => {}
            }
        }
    });

    let base_url = format!("http://127.0.0.1:{port}");
    wait_for_health(&base_url, &died).await?;

    let info = BackendInfo { base_url, token };
    let state = app.state::<SidecarState>();
    if let Ok(mut guard) = state.info.lock() {
        *guard = Some(info.clone());
    }
    Ok(info)
}

async fn wait_for_health(base_url: &str, died: &AtomicBool) -> Result<(), SidecarError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|error| SidecarError::Spawn(error.to_string()))?;
    let url = format!("{base_url}/health");
    let deadline = std::time::Instant::now() + HEALTH_TIMEOUT;

    loop {
        if let Ok(response) = client.get(&url).send().await {
            if response.status().is_success() {
                // Check the body too: if the port was taken between free_port()
                // and the child's bind, something else is answering, and it must
                // not be handed the launch token.
                if let Ok(body) = response.json::<serde_json::Value>().await {
                    if body.get("ok") == Some(&serde_json::Value::Bool(true)) {
                        return Ok(());
                    }
                }
            }
        }
        if died.load(Ordering::SeqCst) {
            return Err(SidecarError::Died);
        }
        if std::time::Instant::now() >= deadline {
            return Err(SidecarError::Timeout(HEALTH_TIMEOUT.as_secs()));
        }
        tokio::time::sleep(HEALTH_INTERVAL).await;
    }
}
