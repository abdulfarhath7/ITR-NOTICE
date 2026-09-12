//! `PortalSource`: the Playwright sidecar behind `NoticeSource`. Rust owns
//! the child process; the sidecar owns the browser; neither touches the
//! database. Every stdout line is a JSON event (sidecar/ingest/protocol.py).

use crate::ingest::source::*;
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, Mutex};

/// A cloneable way to write commands to the sidecar, so the challenge
/// answer typed on the screen reaches it while the runner is waiting.
#[derive(Clone)]
pub struct SidecarHandle {
    stdin: Arc<Mutex<ChildStdin>>,
}

impl SidecarHandle {
    pub async fn send(&self, cmd: Value) -> Result<(), SourceError> {
        let mut line = cmd.to_string();
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await.map_err(|e| SourceError::SessionLost(e.to_string()))?;
        stdin.flush().await.map_err(|e| SourceError::SessionLost(e.to_string()))
    }

    pub async fn submit_challenge(&self, kind: &str, value: &str) -> Result<(), SourceError> {
        // The value is never logged.
        self.send(json!({"cmd": "challenge", "kind": kind, "value": value})).await
    }

    pub async fn set_pace(&self, seconds: f64) -> Result<(), SourceError> {
        self.send(json!({"cmd": "pace", "seconds": seconds})).await
    }
}

/// Pause and stop flags shared with the runner and the commands. A pause
/// holds the next verdict, so the sidecar simply waits on its list page;
/// a stop turns the next verdict into Stop.
#[derive(Clone, Default)]
pub struct Controls {
    pub paused: Arc<AtomicBool>,
    pub stopping: Arc<AtomicBool>,
}

impl Controls {
    pub fn paused(&self) -> bool { self.paused.load(Ordering::Relaxed) }
    pub fn stopping(&self) -> bool { self.stopping.load(Ordering::Relaxed) }
    pub async fn wait_while_paused(&self) {
        while self.paused() && !self.stopping() {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }
    }
}

pub struct PortalSource {
    child: Child,
    handle: SidecarHandle,
    events: mpsc::UnboundedReceiver<Value>,
    logged_in: bool,
    controls: Controls,
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "draftax_sidecar.exe" } else { "draftax_sidecar" }
}

/// Where the frozen sidecar folder is: the bundle resources, or the dev
/// tree's `sidecar/dist/`.
fn locate<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<PathBuf, SourceError> {
    let name = exe_name();
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() { roots.push(res); }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.to_path_buf());
            roots.push(dir.join("..").join(".."));
            roots.push(dir.join("..").join("..").join(".."));
        }
    }
    if let Ok(cwd) = std::env::current_dir() { roots.push(cwd.join("..")); roots.push(cwd); }
    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in roots {
        candidates.push(root.join("resources").join("sidecar").join(name));
        candidates.push(root.join("sidecar").join(name));
        candidates.push(root.join("src-tauri").join("resources").join("sidecar").join(name));
        candidates.push(root.join("sidecar").join("dist").join("draftax_sidecar").join(name));
    }
    candidates.into_iter().find(|p| p.exists()).ok_or_else(|| {
        let script = if cfg!(windows) { "sidecar/build.ps1" } else { "sidecar/build.sh" };
        SourceError::Other(format!("sidecar not found - build it first: {script}"))
    })
}

impl PortalSource {
    pub async fn spawn<R: tauri::Runtime>(app: AppHandle<R>, controls: Controls) -> Result<Self, SourceError> {
        let exe = locate(&app)?;
        let data_dir = app.path().app_data_dir().map_err(|e| SourceError::Other(e.to_string()))?;
        std::fs::create_dir_all(&data_dir).map_err(|e| SourceError::Other(e.to_string()))?;
        let mut cmd = Command::new(&exe);
        cmd.current_dir(exe.parent().unwrap_or(&exe))
            .env("HEADLESS", std::env::var("DRAFTAX_HEADLESS").unwrap_or_else(|_| "true".into()))
            .env("DEBUG_DIR", data_dir.join("debug"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| SourceError::Other(format!("could not start the sidecar: {e}")))?;
        let stdin = child.stdin.take().ok_or_else(|| SourceError::Other("no stdin".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| SourceError::Other("no stdout".into()))?;
        let stderr = child.stderr.take().ok_or_else(|| SourceError::Other("no stderr".into()))?;

        let (tx, rx) = mpsc::unbounded_channel::<Value>();
        // stdout: protocol events to the runner; frames and log lines also
        // straight to the screen so it stays live while the runner waits.
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let ev: Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => json!({"ev": "log", "level": "warn", "msg": line}),
                };
                match ev.get("ev").and_then(Value::as_str) {
                    Some("viewport") => { let _ = app2.emit("ingestion", json!({"ev": "viewport", "img": ev["img"]})); }
                    Some("log") => { let _ = app2.emit("ingestion", json!({"ev": "log", "level": ev["level"], "msg": ev["msg"]})); }
                    Some("progress") => { let _ = app2.emit("ingestion", json!({"ev": "progress", "data": ev})); }
                    _ => {}
                }
                if tx.send(ev).is_err() { break; }
            }
            let _ = tx.send(json!({"ev": "exited"}));
        });
        // stderr: tracebacks to the log pane, never silent.
        let app3 = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app3.emit("ingestion", json!({"ev": "log", "level": "error", "msg": format!("! {line}")}));
            }
        });

        let handle = SidecarHandle { stdin: Arc::new(Mutex::new(stdin)) };
        let mut source = PortalSource { child, handle, events: rx, logged_in: false, controls };
        // wait for ready
        loop {
            match source.events.recv().await {
                Some(ev) if ev["ev"] == "ready" => break,
                Some(ev) if ev["ev"] == "exited" => return Err(SourceError::Other("sidecar exited before it was ready".into())),
                Some(_) => continue,
                None => return Err(SourceError::Other("sidecar closed its output".into())),
            }
        }
        Ok(source)
    }

    pub fn handle(&self) -> SidecarHandle {
        self.handle.clone()
    }

    pub async fn stop(mut self) {
        let _ = self.handle.send(json!({"cmd": "stop"})).await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(8), self.child.wait()).await;
        let _ = self.child.kill().await;
    }

    async fn next_event(&mut self) -> Result<Value, SourceError> {
        match self.events.recv().await {
            Some(ev) if ev["ev"] == "exited" => { self.logged_in = false; Err(SourceError::SessionLost("the sidecar exited".into())) }
            Some(ev) => Ok(ev),
            None => Err(SourceError::SessionLost("the sidecar closed its output".into())),
        }
    }
}

fn s(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}

impl NoticeSource for PortalSource {
    fn login<'a>(&'a mut self, login: &'a LoginRef, password: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<(), SourceError>> {
        Box::pin(async move {
            self.handle.send(json!({"cmd": "login", "login_ref": login.login_ref, "password": password})).await?;
            loop {
                let ev = self.next_event().await?;
                match ev["ev"].as_str() {
                    Some("challenge") => sink.on_challenge(&Challenge {
                        kind: s(&ev["kind"]), image_b64: ev["image_b64"].as_str().map(str::to_string),
                    }),
                    Some("login_phase") => sink.on_log("info", &format!("login: {}", s(&ev["phase"]))),
                    Some("login_ok") => { self.logged_in = true; return Ok(()); }
                    Some("login_failed") => {
                        return Err(match ev["reason"].as_str() {
                            Some("wrong_password") => SourceError::WrongPassword,
                            _ => SourceError::LoginFailed(s(&ev["msg"])),
                        });
                    }
                    Some("error") => sink.on_log("error", &s(&ev["msg"])),
                    _ => {}
                }
            }
        })
    }

    fn list_work_items<'a>(&'a mut self, _module: Module, panel: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<PanelResult, SourceError>> {
        Box::pin(async move {
            if !self.logged_in {
                return Err(SourceError::SessionLost("not logged in".into()));
            }
            self.handle.send(json!({"cmd": "list", "panel": panel, "module": _module.as_str()})).await?;
            let mut missing = false;
            let mut missing_note: Option<String> = None;
            loop {
                let ev = self.next_event().await?;
                match ev["ev"].as_str() {
                    Some("header") => {
                        let header: WorkItemHeader = serde_json::from_value(ev.clone())
                            .map_err(|e| SourceError::Other(format!("bad header event: {e}")))?;
                        let mut verdict = sink.on_header(&header);
                        self.controls.wait_while_paused().await;
                        if self.controls.stopping() { verdict = Verdict::Stop; }
                        let action = match verdict { Verdict::Skip => "skip", Verdict::Fetch => "fetch", Verdict::Stop => "stop" };
                        self.handle.send(json!({"cmd": "next", "action": action})).await?;
                    }
                    Some("item") => {
                        let pdf = ev["pdf_b64"].as_str()
                            .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok());
                        let receipt = ev["receipt_b64"].as_str()
                            .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok());
                        sink.on_item(WorkItemDetail {
                            reference_id: s(&ev["reference_id"]),
                            filename: ev["filename"].as_str().map(str::to_string),
                            pdf, receipt, note: ev["note"].as_str().map(str::to_string),
                        });
                    }
                    Some("panel_missing") => { missing = true; missing_note = ev["msg"].as_str().map(str::to_string); }
                    Some("panel_done") => {
                        return Ok(PanelResult {
                            panel: s(&ev["panel"]),
                            cards: ev["cards"].as_i64().unwrap_or(0), notices: ev["notices"].as_i64().unwrap_or(0),
                            fetched: ev["fetched"].as_i64().unwrap_or(0), skipped: ev["skipped"].as_i64().unwrap_or(0),
                            stopped_early: ev["stopped_early"].as_bool().unwrap_or(false),
                            note: ev["note"].as_str().map(str::to_string).or(missing_note), missing,
                        });
                    }
                    Some("challenge") => sink.on_challenge(&Challenge {
                        kind: s(&ev["kind"]), image_b64: ev["image_b64"].as_str().map(str::to_string),
                    }),
                    Some("error") => {
                        let msg = s(&ev["msg"]);
                        return match ev["kind"].as_str() {
                            Some("not_logged_in") => { self.logged_in = false; Err(SourceError::SessionLost(msg)) }
                            _ => Err(SourceError::Other(msg)),
                        };
                    }
                    _ => {}
                }
            }
        })
    }

    fn fetch_item<'a>(&'a mut self, _reference_id: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<Option<WorkItemDetail>, SourceError>> {
        // The portal hands a document over only from its own list page, so
        // this engine fetches inline during `list_work_items` (a Fetch
        // verdict) and cannot fetch by reference on its own.
        Box::pin(async move {
            sink.on_log("warn", "the portal engine fetches documents while listing; nothing fetched by reference");
            Ok(None)
        })
    }

    fn logout<'a>(&'a mut self) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            if self.logged_in {
                let _ = self.handle.send(json!({"cmd": "logout"})).await;
                // drain until logged_out or a short timeout
                let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
                while tokio::time::Instant::now() < deadline {
                    match tokio::time::timeout_at(deadline, self.events.recv()).await {
                        Ok(Some(ev)) if ev["ev"] == "logged_out" || ev["ev"] == "exited" => break,
                        Ok(Some(_)) => continue,
                        _ => break,
                    }
                }
            }
            self.logged_in = false;
        })
    }

    fn health(&self) -> SourceHealth {
        if self.logged_in { SourceHealth::Ok } else { SourceHealth::Degraded }
    }
}
