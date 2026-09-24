//! Ingestion commands (docs/08): start, pause, resume, stop, state, the
//! operator's challenge answer, and a single-client refresh.

use crate::commands::lock_db;
use crate::error::{AppError, AppResult};
use crate::ingest::portal_source::{Controls, SidecarHandle};
use crate::ingest::runner::{RunHandle, Runner};
use crate::ingest::state::{self, IngestionState, Shared};
use crate::repo::model::IngestionRun;
use crate::repo::cadence::{self, Cadences};
use crate::repo::queue::{self, Job, Scope, Sweep};
use crate::repo::{local, runs};
use crate::AppState;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

pub struct IngestionService {
    pub shared: Shared,
    pub current: Mutex<Option<RunHandle>>,
}

impl Default for IngestionService {
    fn default() -> Self {
        Self { shared: Arc::new(Mutex::new(IngestionState::default())), current: Mutex::new(None) }
    }
}

#[derive(Debug, Serialize)]
pub struct StateView {
    #[serde(flatten)]
    pub state: IngestionState,
    /// A sweep left unfinished by a previous process; Resume continues it
    /// at the next panel of the next client.
    pub resumable_sweep_id: Option<String>,
    pub last_run_at: Option<String>,
}

fn launch(app: AppHandle, state: &AppState, sweep: Sweep, whole_book: bool) -> AppResult<String> {
    let svc = &state.ingestion;
    {
        let cur = svc.current.lock().map_err(|e| AppError::state(e.to_string()))?;
        if cur.is_some() && state::snapshot(&svc.shared).running {
            return Err(AppError::state("a run is already in progress"));
        }
    }
    let device_id = { let con = lock_db(state)?; queue::requeue_interrupted(&con, &sweep.id)?; local::device_id(&con)? };
    let controls = Controls::default();
    let sidecar: Arc<Mutex<Option<SidecarHandle>>> = Arc::new(Mutex::new(None));
    state::update(&svc.shared, |st| {
        *st = IngestionState { running: true, sweep_id: Some(sweep.id.clone()), phase: Some("queued".into()), ..Default::default() };
    });
    if let Ok(mut cur) = svc.current.lock() {
        *cur = Some(RunHandle { sweep_id: sweep.id.clone(), controls: controls.clone(), sidecar: sidecar.clone() });
    }
    let runner = Runner {
        app, db: state.db.clone(), shared: svc.shared.clone(), controls, sidecar,
        sweep_id: sweep.id.clone(), device_id, whole_book,
    };
    tauri::async_runtime::spawn(runner.run());
    Ok(sweep.id)
}

/// OS notification for the moments a run needs a person or has finished;
/// the screen shows the same thing. Never carries a PAN or a name.
pub fn notify<R: tauri::Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    use tauri::Manager;
    use tauri_plugin_notification::NotificationExt;
    // Absent under the test runtime (no plugin managed); never a reason to fail a run.
    if app.try_state::<tauri_plugin_notification::Notification<R>>().is_none() { return; }
    let _ = app.notification().builder().title(title).body(body).show();
}

/// `all` sweeps the modules whose cadence is due (Q12); `all_now` sweeps
/// every module regardless; `module` one module; `client` every module for
/// one client. `modules`, when given, narrows any of those to the modules
/// the operator ticked (e.g. one client, demands and returns only).
#[tauri::command]
pub fn start_ingestion_run(app: AppHandle, state: State<AppState>, scope: Scope, all_now: Option<bool>,
                           modules: Option<Vec<String>>) -> AppResult<String> {
    launch_scope(app, &state, scope, all_now.unwrap_or(false), modules)
}

/// The same entry point the scheduler uses.
pub fn launch_scope(app: AppHandle, state: &AppState, scope: Scope, all_now: bool,
                    only: Option<Vec<String>>) -> AppResult<String> {
    let sweep = {
        let con = lock_db(state)?;
        let device_id = local::device_id(&con)?;
        let every: Vec<String> = queue::MODULES.iter().map(|m| m.to_string()).collect();
        let modules: Vec<String> = match &scope {
            Scope::Module { module } => vec![module.clone()],
            Scope::Client { .. } => every,
            Scope::All => if all_now { every } else {
                let due = cadence::modules_due(&con)?;
                if due.is_empty() { return Err(AppError::state("nothing is due yet by cadence; use Sweep everything now")); }
                due
            },
        };
        let modules: Vec<String> = match &only {
            Some(pick) => {
                if let Some(bad) = pick.iter().find(|m| !queue::MODULES.contains(&m.as_str())) {
                    return Err(AppError::state(format!("unknown module {bad}")));
                }
                // keep the queue's canonical order, whatever order the ticks came in
                modules.into_iter().filter(|m| pick.contains(m)).collect()
            }
            None => modules,
        };
        if modules.is_empty() {
            return Err(AppError::state("no module selected, or none of the selected modules is due yet"));
        }
        let refs: Vec<&str> = modules.iter().map(String::as_str).collect();
        queue::create_sweep(&con, &device_id, &scope, &refs)?
    };
    let whole_book = !matches!(scope, Scope::Client { .. });
    launch(app, state, sweep, whole_book)
}

#[tauri::command]
pub fn get_sweep_schedule(state: State<AppState>) -> AppResult<crate::ingest::scheduler::Schedule> {
    let con = lock_db(&state)?;
    crate::ingest::scheduler::get(&con)
}

#[tauri::command]
pub fn set_sweep_schedule(state: State<AppState>, schedule: crate::ingest::scheduler::Schedule) -> AppResult<()> {
    let con = lock_db(&state)?;
    crate::ingest::scheduler::set(&con, &schedule)
}

#[tauri::command]
pub fn get_sweep_cadence(state: State<AppState>) -> AppResult<Cadences> {
    let con = lock_db(&state)?;
    cadence::get(&con)
}

#[tauri::command]
pub fn set_sweep_cadence(state: State<AppState>, cadences: Cadences) -> AppResult<()> {
    let con = lock_db(&state)?;
    cadence::set(&con, &cadences)
}

#[tauri::command]
pub fn modules_due(state: State<AppState>) -> AppResult<Vec<String>> {
    let con = lock_db(&state)?;
    cadence::modules_due(&con)
}

/// Continue the sweep a previous process left unfinished.
#[tauri::command]
pub fn resume_ingestion_sweep(app: AppHandle, state: State<AppState>, sweep_id: String) -> AppResult<String> {
    let sweep = {
        let con = lock_db(&state)?;
        let s = queue::sweep(&con, &sweep_id)?.ok_or_else(|| AppError::not_found("sweep"))?;
        queue::set_sweep_status(&con, &sweep_id, "running")?;
        s
    };
    let whole_book = !sweep.scope.contains("\"client\"");
    launch(app, &state, sweep, whole_book)
}

/// A portal client refreshes locally on any device. An ERI client's signing
/// key never leaves the collector, so a laptop queues the request to it
/// through the relay (docs/06).
#[tauri::command]
pub async fn refresh_client(app: AppHandle, state: State<'_, AppState>, client_id: String) -> AppResult<String> {
    let (source, login_ref, relay_cfg, collector_id, device_id) = {
        let con = lock_db(&state)?;
        let c = crate::repo::clients::get(&con, &client_id)?.ok_or_else(|| AppError::not_found("client"))?;
        (c.source, c.portal_login_ref.unwrap_or(c.pan), crate::relay::config(&con)?,
         local::get(&con, crate::relay::KEY_COLLECTOR_ID)?, local::device_id(&con)?)
    };
    if source == "eri" && collector_id.as_deref() != Some(device_id.as_str()) {
        let cfg = relay_cfg.ok_or_else(|| AppError::state("an ERI client refreshes on the collector; this device has no relay to reach it"))?;
        crate::relay::Relay::new(cfg).request_refresh(&login_ref).await?;
        return Ok("queued-to-collector".into());
    }
    launch_scope(app, &state, Scope::Client { client_id }, true, None)
}

#[tauri::command]
pub fn pause_ingestion_run(state: State<AppState>) -> AppResult<()> {
    let svc = &state.ingestion;
    let cur = svc.current.lock().map_err(|e| AppError::state(e.to_string()))?;
    let h = cur.as_ref().ok_or_else(|| AppError::state("nothing is running"))?;
    h.controls.paused.store(true, std::sync::atomic::Ordering::Relaxed);
    state::update(&svc.shared, |st| st.paused = true);
    Ok(())
}

#[tauri::command]
pub fn resume_ingestion_run(state: State<AppState>) -> AppResult<()> {
    let svc = &state.ingestion;
    let cur = svc.current.lock().map_err(|e| AppError::state(e.to_string()))?;
    let h = cur.as_ref().ok_or_else(|| AppError::state("nothing is running"))?;
    h.controls.paused.store(false, std::sync::atomic::Ordering::Relaxed);
    state::update(&svc.shared, |st| st.paused = false);
    Ok(())
}

/// Stop after the current client: the runner drains the panel it is on,
/// records it, and does not start the next job.
#[tauri::command]
pub fn stop_ingestion_run(state: State<AppState>) -> AppResult<()> {
    let svc = &state.ingestion;
    let cur = svc.current.lock().map_err(|e| AppError::state(e.to_string()))?;
    let h = cur.as_ref().ok_or_else(|| AppError::state("nothing is running"))?;
    h.controls.stopping.store(true, std::sync::atomic::Ordering::Relaxed);
    h.controls.paused.store(false, std::sync::atomic::Ordering::Relaxed);
    state::update(&svc.shared, |st| { st.phase = Some("stopping".into()); st.paused = false; });
    Ok(())
}

#[tauri::command]
pub fn get_ingestion_state(state: State<AppState>) -> AppResult<StateView> {
    let snapshot = state::snapshot(&state.ingestion.shared);
    let con = lock_db(&state)?;
    let resumable = if snapshot.running { None } else { queue::unfinished_sweep(&con)?.map(|s| s.id) };
    let last_run_at = runs::latest(&con)?.map(|r| r.run_at);
    Ok(StateView { state: snapshot, resumable_sweep_id: resumable, last_run_at })
}

/// The captcha text or OTP. `value` is never logged and never stored.
#[tauri::command]
pub async fn submit_login_challenge(state: State<'_, AppState>, kind: String, value: String) -> AppResult<()> {
    let handle = {
        let cur = state.ingestion.current.lock().map_err(|e| AppError::state(e.to_string()))?;
        let h = cur.as_ref().ok_or_else(|| AppError::state("nothing is running"))?;
        let sidecar = h.sidecar.lock().map_err(|e| AppError::state(e.to_string()))?;
        sidecar.clone().ok_or_else(|| AppError::state("no portal session is open"))?
    };
    if value.trim().is_empty() {
        return Err(AppError::invalid("enter the code first"));
    }
    handle.submit_challenge(&kind, value.trim()).await.map_err(|e| AppError::Sidecar { message: e.to_string() })?;
    state::update(&state.ingestion.shared, |st| { st.awaiting_operator = None; st.phase = Some("logging in".into()); });
    Ok(())
}

#[tauri::command]
pub async fn set_ingestion_pace(state: State<'_, AppState>, seconds: f64) -> AppResult<()> {
    let handle = {
        let cur = state.ingestion.current.lock().map_err(|e| AppError::state(e.to_string()))?;
        cur.as_ref().and_then(|h| h.sidecar.lock().ok().and_then(|s| s.clone()))
    };
    if let Some(h) = handle {
        h.set_pace(seconds).await.map_err(|e| AppError::Sidecar { message: e.to_string() })?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_ingestion_jobs(state: State<AppState>, sweep_id: Option<String>) -> AppResult<Vec<Job>> {
    let con = lock_db(&state)?;
    let id = match sweep_id.or_else(|| state::snapshot(&state.ingestion.shared).sweep_id) {
        Some(id) => id,
        None => match queue::unfinished_sweep(&con)? { Some(s) => s.id, None => return Ok(Vec::new()) },
    };
    queue::jobs(&con, &id)
}

#[tauri::command]
pub fn list_ingestion_runs(state: State<AppState>, limit: Option<i64>) -> AppResult<Vec<IngestionRun>> {
    let con = lock_db(&state)?;
    let mut st = con.prepare("SELECT * FROM ingestion_runs ORDER BY run_at DESC LIMIT ?1")?;
    let rows = st.query_map([limit.unwrap_or(60)], runs::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn get_sync_line(state: State<AppState>) -> AppResult<runs::SyncLine> {
    let con = lock_db(&state)?;
    runs::sync_line(&con)
}

/// The Updates screen (docs/16 §4): what changed since the previous run.
#[tauri::command]
pub fn list_updates(state: State<AppState>, since: Option<String>) -> AppResult<crate::repo::updates::UpdatesReport> {
    let con = lock_db(&state)?;
    crate::repo::updates::list(&con, since)
}
