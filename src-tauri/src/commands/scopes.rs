//! Scrape-scope commands (docs/17 §7): deep fetch requests, item fetch,
//! estimates, the sweep settings, the per-client sync and cadence
//! controls, and the Sync screen's overview.

use crate::commands::ingestion::{busy, launch};
use crate::commands::lock_db;
use crate::error::AppResult;
use crate::ingest::scheduler::{self, Schedule};
use crate::ingest::state;
use crate::mask;
use crate::repo::queue::{self, ItemTarget, RunKind, Scope, SweepScope};
use crate::repo::scopes::{self, DeepFetchRequest, DeepInput};
use crate::repo::local;
use crate::AppState;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
pub struct DeepFetchResult {
    pub request: DeepFetchRequest,
    /// `started` (runs now), `queued` (tonight, or after the run in flight).
    pub status: String,
    pub sweep_id: Option<String>,
}

/// Create or replace a request; `now` starts it in the foreground, or
/// queues it right after the run that holds the session (§2.4).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn request_deep_fetch(app: AppHandle, state: State<AppState>, client_id: String, depth: String,
                          depth_value: Option<String>, modules: Vec<String>, docs_policy: String,
                          mode: String) -> AppResult<DeepFetchResult> {
    let (request, sweep) = {
        let con = lock_db(&state)?;
        let operator = local::get(&con, "operator_name").ok().flatten();
        let request = scopes::request_deep(&con, &DeepInput {
            client_id: &client_id, depth: &depth, depth_value: depth_value.as_deref(), modules: &modules,
            docs_policy: &docs_policy, mode: &mode, requested_by: operator.as_deref(),
        })?;
        if mode != "now" || busy(&state) {
            (request, None)
        } else {
            let device_id = local::device_id(&con)?;
            let scope = SweepScope { kind: RunKind::Deep, selector: Scope::Client { client_id: client_id.clone() },
                                     scheduled: false, deep_request_id: Some(request.id.clone()), item: None };
            let refs: Vec<&str> = queue::MODULES.iter().copied().filter(|m| modules.iter().any(|x| x == m)).collect();
            (request, Some(queue::create_sweep_scoped(&con, &device_id, &scope, &refs)?))
        }
    };
    match sweep {
        Some(sweep) => {
            let id = launch(app, &state, sweep)?;
            Ok(DeepFetchResult { request, status: "started".into(), sweep_id: Some(id) })
        }
        None => Ok(DeepFetchResult { request, status: "queued".into(), sweep_id: None }),
    }
}

#[tauri::command]
pub fn cancel_deep_fetch(state: State<AppState>, id: String) -> AppResult<()> {
    let con = lock_db(&state)?;
    scopes::cancel_deep(&con, &id)
}

#[tauri::command]
pub fn retry_deep_fetch(state: State<AppState>, id: String) -> AppResult<()> {
    let con = lock_db(&state)?;
    scopes::retry_deep(&con, &id)
}

#[tauri::command]
pub fn list_deep_fetch_requests(state: State<AppState>) -> AppResult<Vec<DeepFetchRequest>> {
    let con = lock_db(&state)?;
    scopes::list_deep(&con)
}

#[derive(Debug, Serialize)]
pub struct ItemFetchResult {
    /// `started` · `queued` (after the run in flight) · `busy` (a run holds
    /// the session and the caller did not ask to queue).
    pub status: String,
    pub sweep_id: Option<String>,
}

/// §3: a foreground fetch of one work item's documents.
#[tauri::command]
pub fn fetch_item(app: AppHandle, state: State<AppState>, module: String, id: String,
                  queue_if_busy: Option<bool>) -> AppResult<ItemFetchResult> {
    let sweep = {
        let con = lock_db(&state)?;
        let plan = scopes::item_plan(&con, &module, &id)?;
        if busy(&state) {
            if queue_if_busy.unwrap_or(false) {
                scopes::queue_item_fetch(&con, &module, &id)?;
                return Ok(ItemFetchResult { status: "queued".into(), sweep_id: None });
            }
            return Ok(ItemFetchResult { status: "busy".into(), sweep_id: None });
        }
        let device_id = local::device_id(&con)?;
        let scope = SweepScope { kind: RunKind::Item, selector: Scope::Client { client_id: plan.client_id.clone() },
                                 scheduled: false, deep_request_id: None, item: Some(ItemTarget { module: module.clone(), id }) };
        queue::create_sweep_scoped(&con, &device_id, &scope, &[plan.module.as_str()])?
    };
    let id = launch(app, &state, sweep)?;
    Ok(ItemFetchResult { status: "started".into(), sweep_id: Some(id) })
}

/// §2.9, seconds. No ids: every sweep-enabled portal client.
#[tauri::command]
pub fn sweep_estimate(state: State<AppState>, client_ids: Option<Vec<String>>) -> AppResult<i64> {
    let con = lock_db(&state)?;
    let ids = match client_ids { Some(ids) => ids, None => scopes::book_client_ids(&con)? };
    scopes::sweep_estimate(&con, &ids)
}

#[tauri::command]
pub fn deep_estimate(state: State<AppState>, client_id: String, depth: String, depth_value: Option<String>) -> AppResult<i64> {
    let con = lock_db(&state)?;
    scopes::deep_estimate(&con, &client_id, &depth, depth_value.as_deref())
}

#[tauri::command]
pub fn get_sweep_settings(state: State<AppState>) -> AppResult<Schedule> {
    let con = lock_db(&state)?;
    scheduler::get(&con)
}

#[tauri::command]
pub fn set_sweep_settings(state: State<AppState>, settings: Schedule) -> AppResult<()> {
    let con = lock_db(&state)?;
    scheduler::set(&con, &settings)
}

/// Build 2's toggle plus the pause reason (§6.2).
#[tauri::command]
pub fn set_client_sync(state: State<AppState>, client_id: String, enabled: bool, reason: Option<String>) -> AppResult<()> {
    let con = lock_db(&state)?;
    scopes::set_client_sync(&con, &client_id, enabled, reason.as_deref())
}

#[tauri::command]
pub fn pin_client_cadence(state: State<AppState>, client_id: String, pinned: bool) -> AppResult<()> {
    let con = lock_db(&state)?;
    scopes::pin_cadence(&con, &client_id, pinned)
}

// ------------------------------------------------------------- overview

#[derive(Debug, Serialize)]
pub struct RunCard {
    pub sweep_id: String,
    pub kind: String,
    pub scheduled: bool,
    pub started_at: String,
    pub done: i64,
    pub total: i64,
    pub swept: i64,
    pub skipped: i64,
    pub failed: i64,
}

#[derive(Debug, Serialize)]
pub struct SummaryCard {
    pub sweep_id: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub summary: Value,
}

#[derive(Debug, Serialize)]
pub struct SyncRow {
    pub client_id: String,
    pub client_name: String,
    pub pan_masked: String,
    /// `sweep` · `deep` · `item`
    pub scope: String,
    /// Deep: `full` · `2 AYs` · `since 2026-04-01`.
    pub deep_label: Option<String>,
    pub deep_request_id: Option<String>,
    /// `running` · `awaiting` · `done` · `skipped` · `failed` · `parked` ·
    /// `incomplete` · `queued` · `dormant` · `paused` · `idle`
    pub status: String,
    pub detail: Option<String>,
    pub started_at: Option<String>,
    pub duration_s: Option<i64>,
    pub changes: Option<i64>,
    pub last_swept_at: Option<String>,
    /// `nightly` · `weekly` · `tonight` · `fix` · `none`
    pub next: String,
    pub cadence_tier: String,
    pub cadence_pinned: bool,
    pub position: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct SyncOverview {
    pub run: Option<RunCard>,
    pub last_summary: Option<SummaryCard>,
    pub schedule_enabled: bool,
    pub window_start: String,
    pub window_end: String,
    pub dormant_weekday: u32,
    /// IST `YYYY-MM-DD HH:MM` of the next scheduled start, when one is set.
    pub next_run_at: Option<String>,
    /// Who runs the overnight sweep (docs/18 §7): `this` device, an `other`
    /// device that holds the collector role, or `none` set.
    pub collector: String,
    pub estimate_all_s: i64,
    pub deep_queued: i64,
    pub rows: Vec<SyncRow>,
}

fn next_run_at(s: &Schedule) -> Option<String> {
    use chrono::Datelike;
    if !s.enabled || s.days.is_empty() { return None; }
    let now = scheduler::ist_now();
    let at = chrono::NaiveTime::parse_from_str(&s.run_window_start, "%H:%M").ok()?;
    (0..8).map(|d| now.date() + chrono::Duration::days(d))
        .filter(|day| s.days.contains(&day.weekday().number_from_monday()))
        .map(|day| day.and_time(at))
        .find(|t| *t > now)
        .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
}

fn deep_label(d: &DeepFetchRequest) -> String {
    match d.depth.as_str() {
        "years" => format!("{} AYs", d.depth_value.as_deref().unwrap_or("?")),
        "since" => format!("since {}", d.depth_value.as_deref().unwrap_or("?")),
        _ => "full".into(),
    }
}

fn seconds_between(a: &str, b: &str) -> Option<i64> {
    let a = chrono::DateTime::parse_from_rfc3339(a).ok()?;
    let b = chrono::DateTime::parse_from_rfc3339(b).ok()?;
    Some((b - a).num_seconds().max(0))
}

/// The sweep the queue table describes: the one in flight, else the latest
/// sweep-kind row.
fn table_sweep(con: &Connection, running: Option<&str>) -> AppResult<Option<queue::Sweep>> {
    if let Some(id) = running {
        if let Some(s) = queue::sweep(con, id)? {
            if SweepScope::parse(&s.scope).kind == RunKind::Sweep { return Ok(Some(s)); }
        }
    }
    let id: Option<String> = con.query_row(
        "SELECT id FROM ingestion_sweeps WHERE coalesce(json_extract(scope, '$.kind'), 'sweep') = 'sweep'
          ORDER BY started_at DESC LIMIT 1", [], |r| r.get(0)).optional()?;
    match id { Some(id) => queue::sweep(con, &id), None => Ok(None) }
}

#[tauri::command]
pub fn get_sync_overview(state: State<AppState>) -> AppResult<SyncOverview> {
    let snap = state::snapshot(&state.ingestion.shared);
    let con = lock_db(&state)?;
    let settings = scheduler::get(&con)?;
    let sweep = table_sweep(&con, snap.running.then_some(snap.sweep_id.as_deref()).flatten())?;
    let jobs = match &sweep { Some(s) => queue::jobs(&con, &s.id)?, None => Vec::new() };
    let deep = scopes::list_deep(&con)?;
    let now = crate::ids::now();

    let run = match (&sweep, snap.running) {
        (Some(s), true) => {
            let sc = SweepScope::parse(&s.scope);
            let total = jobs.len() as i64;
            let done = jobs.iter().filter(|j| !matches!(j.status.as_str(), "queued" | "running" | "awaiting_operator")).count() as i64;
            let skipped = jobs.iter().filter(|j| j.status == "done" && j.cursor().unchanged).count() as i64;
            let failed = jobs.iter().filter(|j| j.status == "failed" || j.status == "parked" || (j.status == "queued" && j.attempts > 0)).count() as i64;
            let swept = jobs.iter().filter(|j| j.status == "done" && !j.cursor().unchanged).count() as i64;
            Some(RunCard { sweep_id: s.id.clone(), kind: sc.kind.as_str().into(), scheduled: sc.scheduled,
                           started_at: s.started_at.clone(), done, total, swept, skipped, failed })
        }
        _ => None,
    };
    let last_summary = queue::last_summary(&con)?.map(|s| SummaryCard {
        summary: s.sweep_summary.as_deref().and_then(|j| serde_json::from_str(j).ok()).unwrap_or(Value::Null),
        sweep_id: s.id, started_at: s.started_at, finished_at: s.finished_at,
    });

    let mut rows = Vec::new();
    for c in crate::repo::clients::list(&con)?.into_iter().filter(|c| c.source == "portal") {
        let login = c.portal_login_ref.clone().unwrap_or(c.pan.clone());
        let tier = c.cadence_tier.clone().unwrap_or_else(|| "nightly".into());
        let pinned = c.cadence_pinned.unwrap_or(0) == 1;
        let mine: Vec<&queue::Job> = jobs.iter().filter(|j| j.login_ref == login).collect();
        let active_deep = deep.iter().find(|d| d.client_id == c.id && matches!(d.status.as_str(), "queued" | "running"));
        let failed_deep = deep.iter().find(|d| d.client_id == c.id && d.status == "failed");
        let has = |st: &str| mine.iter().any(|j| j.status == st);
        let first_error = mine.iter().find_map(|j| j.last_error.clone()).map(|e| mask::text(&e));
        let started_at = mine.iter().filter_map(|j| j.started_at.clone()).min();
        let duration = mine.iter().filter_map(|j| match (&j.started_at, &j.finished_at) {
            (Some(a), Some(b)) => seconds_between(a, b),
            (Some(a), None) if j.status == "running" => seconds_between(a, &now),
            _ => None,
        }).reduce(|a, b| a + b);
        let (mut scope, mut label, mut deep_id) = ("sweep".to_string(), None, None);
        let (status, detail): (String, Option<String>) = if c.sync_enabled == Some(0) {
            ("paused".into(), c.sync_pause_reason.clone().filter(|r| !r.is_empty()))
        } else if let Some(d) = active_deep.filter(|d| d.status == "running" || mine.is_empty()) {
            scope = "deep".into(); label = Some(deep_label(d)); deep_id = Some(d.id.clone());
            if d.status == "running" { ("running".into(), None) }
            else { ("queued".into(), Some(if d.mode == "tonight" { "after sweep".into() } else { "after this run".into() })) }
        } else if has("awaiting_operator") {
            ("awaiting".into(), snap.awaiting_operator.as_ref().map(|a| a.kind.to_uppercase()))
        } else if has("running") {
            ("running".into(), None)
        } else if has("parked") {
            ("parked".into(), mine.iter().find(|j| j.status == "parked").and_then(|j| j.last_error.clone()))
        } else if has("failed") || mine.iter().any(|j| j.status == "queued" && j.attempts > 0) {
            ("failed".into(), first_error)
        } else if has("incomplete") {
            ("incomplete".into(), first_error)
        } else if has("queued") {
            ("queued".into(), None)
        } else if !mine.is_empty() && mine.iter().all(|j| j.status == "done") {
            if mine.iter().all(|j| j.cursor().unchanged) { ("skipped".into(), Some("unchanged".into())) } else { ("done".into(), None) }
        } else if let Some(d) = failed_deep {
            scope = "deep".into(); label = Some(deep_label(d)); deep_id = Some(d.id.clone());
            ("failed".into(), d.last_error.clone())
        } else if tier == "weekly" && !pinned {
            ("dormant".into(), None)
        } else {
            ("idle".into(), None)
        };
        let changes: Option<i64> = match &sweep {
            Some(s) if !mine.is_empty() => con.query_row(
                "SELECT sum(coalesce(json_extract(gaps, '$.changed'), 0)) FROM ingestion_runs
                  WHERE client_id = ?1 AND run_at >= ?2 AND scope = 'sweep'",
                rusqlite::params![c.id, s.started_at], |r| r.get(0)).optional()?.flatten(),
            _ => None,
        };
        let next = if c.sync_enabled == Some(0) { "none" }
            else if status == "parked" { "fix" }
            else if active_deep.map(|d| d.mode == "tonight" && d.status == "queued").unwrap_or(false) { "tonight" }
            else if tier == "weekly" && !pinned { "weekly" }
            else { "nightly" };
        rows.push(SyncRow {
            client_id: c.id.clone(), client_name: c.name.clone(), pan_masked: mask::pan(&c.pan), scope,
            deep_label: label, deep_request_id: deep_id, status, detail, started_at, duration_s: duration,
            changes, last_swept_at: c.last_swept_at.clone(), next: next.into(), cadence_tier: tier,
            cadence_pinned: pinned, position: mine.iter().map(|j| j.position).min(),
        });
    }
    // The frozen order first (§2.1), then the rest by name.
    rows.sort_by(|a, b| match (a.position, b.position) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a.client_name.to_lowercase().cmp(&b.client_name.to_lowercase()),
    });

    let collector = match (crate::relay::config(&con)?, local::get(&con, crate::relay::KEY_COLLECTOR_ID)?) {
        (None, _) => "this".to_string(),
        (Some(_), Some(id)) if id == local::device_id(&con)? => "this".to_string(),
        (Some(_), Some(_)) => "other".to_string(),
        (Some(_), None) => "none".to_string(),
    };
    Ok(SyncOverview {
        run, last_summary, schedule_enabled: settings.enabled, collector,
        window_start: settings.run_window_start.clone(), window_end: settings.run_window_end.clone(),
        dormant_weekday: settings.dormant_weekday, next_run_at: next_run_at(&settings),
        estimate_all_s: scopes::sweep_estimate(&con, &scopes::book_client_ids(&con)?)?,
        deep_queued: deep.iter().filter(|d| d.status == "queued").count() as i64,
        rows,
    })
}

/// docs/18 §7 estimate line: the AYs the client holds, the row count the
/// last listing probe saw (None until a probe has run), and the seconds
/// docs/17 §2.9 estimates for the depth.
#[derive(Debug, Serialize)]
pub struct DeepProbeInfo {
    pub first_ay: Option<String>,
    pub last_ay: Option<String>,
    pub probe_rows: Option<i64>,
    pub seconds: i64,
}

#[tauri::command]
pub fn deep_probe_info(state: State<AppState>, client_id: String, depth: String, depth_value: Option<String>) -> AppResult<DeepProbeInfo> {
    let con = lock_db(&state)?;
    let (first_ay, last_ay): (Option<String>, Option<String>) = con.query_row(
        "SELECT min(assessment_year), max(assessment_year) FROM year_contexts WHERE client_id = ?1 AND assessment_year IS NOT NULL",
        [&client_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let probe_rows: Option<i64> = con.query_row(
        "SELECT sum(p.rows) FROM probe_state p JOIN clients c ON coalesce(c.portal_login_ref, c.pan) = p.login_ref WHERE c.id = ?1",
        [&client_id], |r| r.get(0)).optional()?.flatten();
    let seconds = scopes::deep_estimate(&con, &client_id, &depth, depth_value.as_deref())?;
    Ok(DeepProbeInfo { first_ay, last_ay, probe_rows, seconds })
}

/// The Updates screen's first card (§2.8).
#[tauri::command]
pub fn get_last_sweep_summary(state: State<AppState>) -> AppResult<Option<SummaryCard>> {
    let con = lock_db(&state)?;
    Ok(queue::last_summary(&con)?.map(|s| SummaryCard {
        summary: s.sweep_summary.as_deref().and_then(|j| serde_json::from_str(j).ok()).unwrap_or(Value::Null),
        sweep_id: s.id, started_at: s.started_at, finished_at: s.finished_at,
    }))
}
