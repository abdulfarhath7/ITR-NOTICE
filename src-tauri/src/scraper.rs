//! The sidecar bridge. Rust owns the child process; the webview never touches
//! it. Every stdout line is JSON: "notice" events are absorbed into the
//! archive through `intake` here, everything else is re-emitted to the UI as
//! a Tauri event named `scraper`.

use crate::intake::{self, NoticeCard, ProceedingCard};
use base64::Engine;
use rusqlite::Connection;
use serde::Deserialize;
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
    /// The PAN this session logged in as. A "Self" card that prints no PAN
    /// is attached to it (D-009).
    login_pan: Arc<Mutex<Option<String>>>,
}

/// A notice as the sidecar reports it (one "notice" event = one of these).
#[derive(Debug, Deserialize)]
pub struct IncomingNotice {
    pub ref_id: String,
    pub notice_us: Option<String>,
    pub doc_ref_id: Option<String>,
    pub description: Option<String>,
    pub issued_on: Option<String>,
    pub served_on: Option<String>,
    pub due_date: Option<String>,
    pub due_date_source: Option<String>,
    pub ao_viewed_on: Option<String>,
    pub responded: Option<i64>,
    pub downloaded_at: Option<String>,
    pub pdf_b64: Option<String>,
    // proceeding
    pub tab: Option<String>,
    pub sub_tab: Option<String>,
    pub proceeding_name: Option<String>,
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub financial_year: Option<String>,
    pub applicable_act: Option<String>,
    pub proceeding_status: Option<String>,
    pub closure_date: Option<String>,
    pub closure_order: Option<String>,
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "notice_scraper.exe" } else { "notice_scraper" }
}

/// Where the bundled sidecar folder ended up. Every plausible root is tried so
/// the same binary works from `tauri dev` (cwd = `src-tauri/`), from a release
/// binary run out of `target/release/` with any cwd, and from the installed app.
fn locate(app: &AppHandle) -> Result<PathBuf, String> {
    let name = exe_name();
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        roots.push(res);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
            roots.push(dir.join("..").join("..")); // target/release -> src-tauri
            roots.push(dir.join("..").join("..").join("..")); // -> repo root
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join(".."));
        roots.push(cwd);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in roots {
        candidates.push(root.join("resources").join("scraper").join(name));
        candidates.push(root.join("scraper").join(name));
        candidates.push(root.join("src-tauri").join("resources").join("scraper").join(name));
        candidates.push(root.join("sidecar").join("dist").join("notice_scraper").join(name));
    }
    candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
        let script = if cfg!(windows) { "sidecar/build.ps1" } else { "sidecar/build.sh" };
        format!("sidecar not found - build it first: {script} (see README)")
    })
}

impl Scraper {
    pub async fn spawn(app: AppHandle, archive: Arc<Mutex<Connection>>) -> Result<Self, String> {
        let login_pan: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
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
        let (app2, archive2, pan2) = (app.clone(), archive.clone(), login_pan.clone());
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                match serde_json::from_str::<Value>(&line) {
                    Ok(ev) => handle_event(&app2, &archive2, &pan2, ev),
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

        Ok(Self { child, stdin, login_pan })
    }

    pub fn set_login_pan(&self, pan: &str) {
        if let Ok(mut p) = self.login_pan.lock() {
            *p = Some(pan.trim().to_ascii_uppercase());
        }
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

fn absorb(con: &mut Connection, login_pan: Option<&str>, n: IncomingNotice) -> Result<(), String> {
    let pdf = n.pdf_b64.as_deref().and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok());
    let card = ProceedingCard {
        tab: n.tab.unwrap_or_else(|| "self".into()),
        sub_tab: n.sub_tab.unwrap_or_else(|| "action".into()),
        proceeding_name: n.proceeding_name, pan: n.pan, assessee_name: n.assessee_name,
        assessment_year: n.assessment_year, financial_year: n.financial_year,
        applicable_act: n.applicable_act, status: n.proceeding_status,
        closure_date: n.closure_date, closure_order: n.closure_order,
    };
    let notice = NoticeCard {
        ref_id: n.ref_id, notice_us: n.notice_us, doc_ref_id: n.doc_ref_id,
        description: n.description, issued_on: n.issued_on, served_on: n.served_on,
        due_date: n.due_date, due_date_source: n.due_date_source, ao_viewed_on: n.ao_viewed_on,
        responded: n.responded, downloaded_at: n.downloaded_at, pdf,
    };
    // One transaction per notice: the document, the rows and (later) the
    // ledger entries land together or not at all.
    let tx = con.transaction().map_err(|e| e.to_string())?;
    intake::absorb(&tx, login_pan, &card, Some(&notice)).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn handle_event(app: &AppHandle, archive: &Arc<Mutex<Connection>>,
                login_pan: &Arc<Mutex<Option<String>>>, ev: Value) {
    if ev.get("ev").and_then(Value::as_str) == Some("notice") {
        match serde_json::from_value::<IncomingNotice>(ev.clone()) {
            Ok(n) => {
                let ref_id = n.ref_id.clone();
                let pan = login_pan.lock().ok().and_then(|p| p.clone());
                let result = archive.lock().map_err(|e| e.to_string())
                    .and_then(|mut con| absorb(&mut con, pan.as_deref(), n));
                match result {
                    Ok(()) => { let _ = app.emit("scraper", json!({"ev": "notice", "ref_id": ref_id})); }
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
