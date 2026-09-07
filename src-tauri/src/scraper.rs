//! The sidecar bridge. Rust owns the child process; the webview never touches
//! it. Every stdout line is JSON: "notice" events are written straight into
//! the encrypted archive here, everything else is re-emitted to the UI as a
//! Tauri event named `scraper`.

use crate::db::{self, IncomingNotice};
use base64::Engine;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

pub struct Scraper {
    child: Child,
    stdin: ChildStdin,
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "notice_scraper.exe" } else { "notice_scraper" }
}

/// Where the bundled sidecar folder ended up. Checked in order so the same
/// binary works from `tauri dev` (repo layout) and from the installed app.
fn locate(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("resources").join("scraper").join(exe_name()));
        candidates.push(res.join("scraper").join(exe_name()));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("resources").join("scraper").join(exe_name()));
        candidates.push(cwd.join("..").join("sidecar").join("dist").join("notice_scraper").join(exe_name()));
    }
    candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
        "sidecar not found - build it first: sidecar/build.ps1 (see README)".to_string()
    })
}

impl Scraper {
    pub async fn spawn(app: AppHandle, archive: Arc<Mutex<Connection>>) -> Result<Self, String> {
        let exe = locate(&app)?;
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

        let mut cmd = Command::new(&exe);
        cmd.current_dir(exe.parent().unwrap())
            .env("NOTICE_DB", data_dir.join("staging.db"))
            .env("HEADLESS", std::env::var("NOTICE_HEADLESS").unwrap_or_else(|_| "true".into()))
            .env("DEBUG_DIR", data_dir.join("debug"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| format!("could not start sidecar: {e}"))?;
        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        // stdout: the protocol
        let (app2, archive2) = (app.clone(), archive.clone());
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match serde_json::from_str::<Value>(&line) {
                    Ok(ev) => handle_event(&app2, &archive2, ev),
                    Err(_) => {
                        let _ = app2.emit("scraper", json!({"ev": "log", "msg": line}));
                    }
                }
            }
            let _ = app2.emit("scraper", json!({"ev": "exited"}));
        });

        // stderr: Python tracebacks -> log pane, so a crash is never silent
        let app3 = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app3.emit("scraper", json!({"ev": "stderr", "msg": line}));
            }
        });

        Ok(Self { child, stdin })
    }

    pub async fn send(&mut self, cmd: Value) -> Result<(), String> {
        let mut line = cmd.to_string();
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        self.stdin.flush().await.map_err(|e| e.to_string())
    }

    pub async fn stop(mut self) {
        let _ = self.send(json!({"cmd": "stop"})).await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), self.child.wait()).await;
        let _ = self.child.kill().await;
    }
}

fn handle_event(app: &AppHandle, archive: &Arc<Mutex<Connection>>, ev: Value) {
    if ev.get("ev").and_then(Value::as_str) == Some("notice") {
        match serde_json::from_value::<IncomingNotice>(ev.clone()) {
            Ok(n) => {
                let pdf = n.pdf_b64.as_deref().and_then(|b| {
                    base64::engine::general_purpose::STANDARD.decode(b).ok()
                });
                let result = archive.lock().map_err(|e| e.to_string())
                    .and_then(|con| db::absorb_notice(&con, &n, pdf));
                match result {
                    Ok(()) => { let _ = app.emit("scraper", json!({"ev": "notice", "ref_id": n.ref_id})); }
                    Err(e) => { let _ = app.emit("scraper", json!({"ev": "error", "kind": "db", "msg": e})); }
                }
            }
            Err(e) => {
                let _ = app.emit("scraper", json!({"ev": "error", "kind": "parse", "msg": e.to_string()}));
            }
        }
        return;
    }
    let _ = app.emit("scraper", ev);
}
