//! Scrape scopes (docs/17): the probe's stored hashes, deep fetch
//! requests, the per-client history and cadence columns, and the run
//! estimates. Local tables; the client columns sync like any client field.

use crate::error::{AppError, AppResult};
use crate::ids::{new_id, now};
use crate::repo::clients;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

// ------------------------------------------------------------------ probe

/// The stored hash for every panel of `login_ref`, or none on a first sweep.
pub fn probe_hashes(con: &Connection, login_ref: &str) -> AppResult<std::collections::HashMap<String, String>> {
    let mut st = con.prepare("SELECT panel, list_hash FROM probe_state WHERE login_ref = ?1")?;
    let rows = st.query_map([login_ref], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn save_probe(con: &Connection, login_ref: &str, panel: &str, list_hash: &str, rows: i64) -> AppResult<()> {
    con.execute(
        "INSERT INTO probe_state (login_ref, panel, list_hash, rows, checked_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(login_ref, panel) DO UPDATE SET list_hash = excluded.list_hash, rows = excluded.rows,
                                                     checked_at = excluded.checked_at",
        params![login_ref, panel, list_hash, rows, now()])?;
    Ok(())
}

/// Open items reachable through a login. The probe hashes listing cards,
/// which do not show a notice's due date or reply state, so a login with
/// open items is always walked in full (D-050, Q47).
pub fn login_has_open_items(con: &Connection, login_ref: &str) -> AppResult<bool> {
    let n: i64 = con.query_row(
        "SELECT count(*) FROM proceedings p
           JOIN year_contexts y ON y.id = p.year_context_id
           JOIN clients c ON c.id = y.client_id
          WHERE coalesce(c.portal_login_ref, c.pan) = ?1
            AND p.status IN ('open','adjournment_sought','unknown')", [login_ref], |r| r.get(0))?;
    Ok(n > 0)
}

// ------------------------------------------------------------ deep fetch

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeepFetchRequest {
    pub id: String,
    pub client_id: String,
    pub depth: String,
    pub depth_value: Option<String>,
    pub modules: Vec<String>,
    pub docs_policy: String,
    pub mode: String,
    pub status: String,
    pub requested_by: Option<String>,
    pub requested_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub progress: Option<String>,
    pub last_error: Option<String>,
    /// Joined for the Sync screen; not a column.
    #[serde(default)]
    pub client_name: Option<String>,
}

fn deep_row(r: &Row) -> rusqlite::Result<DeepFetchRequest> {
    let modules: String = r.get("modules")?;
    Ok(DeepFetchRequest {
        id: r.get("id")?, client_id: r.get("client_id")?, depth: r.get("depth")?, depth_value: r.get("depth_value")?,
        modules: serde_json::from_str(&modules).unwrap_or_default(), docs_policy: r.get("docs_policy")?,
        mode: r.get("mode")?, status: r.get("status")?, requested_by: r.get("requested_by")?,
        requested_at: r.get("requested_at")?, started_at: r.get("started_at")?, finished_at: r.get("finished_at")?,
        progress: r.get("progress")?, last_error: r.get("last_error")?,
        client_name: r.get("client_name").unwrap_or(None),
    })
}

pub struct DeepInput<'a> {
    pub client_id: &'a str,
    pub depth: &'a str,
    pub depth_value: Option<&'a str>,
    pub modules: &'a [String],
    pub docs_policy: &'a str,
    pub mode: &'a str,
    pub requested_by: Option<&'a str>,
}

/// Create a request, replacing a queued one for the same client (§6.3).
pub fn request_deep(con: &Connection, input: &DeepInput) -> AppResult<DeepFetchRequest> {
    if !matches!(input.depth, "all" | "years" | "since") { return Err(AppError::invalid("depth is all, years or since")); }
    if !matches!(input.docs_policy, "index" | "download") { return Err(AppError::invalid("documents is index or download")); }
    if !matches!(input.mode, "tonight" | "now") { return Err(AppError::invalid("mode is tonight or now")); }
    if input.modules.is_empty() { return Err(AppError::invalid("pick at least one module")); }
    if let Some(bad) = input.modules.iter().find(|m| !crate::repo::queue::MODULES.contains(&m.as_str())) {
        return Err(AppError::invalid(format!("unknown module {bad}")));
    }
    let depth_value = match input.depth {
        "years" => {
            let n: u32 = input.depth_value.and_then(|v| v.trim().parse().ok()).filter(|n| (1..=10).contains(n))
                .ok_or_else(|| AppError::invalid("assessment years is 1 to 10"))?;
            Some(n.to_string())
        }
        "since" => {
            let d = input.depth_value.map(str::trim).unwrap_or("");
            chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").map_err(|_| AppError::invalid("since needs a date"))?;
            Some(d.to_string())
        }
        _ => None,
    };
    clients::get(con, input.client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    con.execute(
        "UPDATE deep_fetch_requests SET status = 'cancelled', finished_at = ?1, last_error = 'replaced by a newer request'
          WHERE client_id = ?2 AND status = 'queued'", params![now(), input.client_id])?;
    let id = new_id();
    con.execute(
        "INSERT INTO deep_fetch_requests (id, client_id, depth, depth_value, modules, docs_policy, mode, status,
                                          requested_by, requested_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', ?8, ?9)",
        params![id, input.client_id, input.depth, depth_value, serde_json::to_string(input.modules)?,
                input.docs_policy, input.mode, input.requested_by, now()])?;
    deep(con, &id)?.ok_or_else(|| AppError::not_found("deep fetch request"))
}

pub fn deep(con: &Connection, id: &str) -> AppResult<Option<DeepFetchRequest>> {
    Ok(con.query_row(
        "SELECT d.*, c.name AS client_name FROM deep_fetch_requests d LEFT JOIN clients c ON c.id = d.client_id
          WHERE d.id = ?1", [id], deep_row).optional()?)
}

/// Queued and running first, then the last few finished, for the Sync screen.
pub fn list_deep(con: &Connection) -> AppResult<Vec<DeepFetchRequest>> {
    let mut st = con.prepare(
        "SELECT d.*, c.name AS client_name FROM deep_fetch_requests d LEFT JOIN clients c ON c.id = d.client_id
          ORDER BY d.status IN ('queued','running') DESC, d.requested_at DESC LIMIT 100")?;
    let rows = st.query_map([], deep_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Oldest queued request of a mode: `tonight` ones after the nightly sweep
/// (§2.4), `now` ones that found a sweep running, after that run.
pub fn next_queued(con: &Connection, mode: &str) -> AppResult<Option<DeepFetchRequest>> {
    Ok(con.query_row(
        "SELECT d.*, c.name AS client_name FROM deep_fetch_requests d LEFT JOIN clients c ON c.id = d.client_id
          WHERE d.status = 'queued' AND d.mode = ?1 ORDER BY d.requested_at LIMIT 1", [mode], deep_row).optional()?)
}

pub fn cancel_deep(con: &Connection, id: &str) -> AppResult<()> {
    let n = con.execute(
        "UPDATE deep_fetch_requests SET status = 'cancelled', finished_at = ?1 WHERE id = ?2 AND status = 'queued'",
        params![now(), id])?;
    if n == 0 { return Err(AppError::state("only a queued request can be cancelled")); }
    Ok(())
}

/// A failed request back in the queue for tonight (the Sync screen's Retry).
pub fn retry_deep(con: &Connection, id: &str) -> AppResult<()> {
    let n = con.execute(
        "UPDATE deep_fetch_requests SET status = 'queued', mode = 'tonight', last_error = NULL, started_at = NULL,
                finished_at = NULL, progress = NULL WHERE id = ?1 AND status = 'failed'", [id])?;
    if n == 0 { return Err(AppError::state("only a failed request can be retried")); }
    Ok(())
}

pub fn set_deep_status(con: &Connection, id: &str, status: &str, error: Option<&str>) -> AppResult<()> {
    let ts = now();
    let started = (status == "running").then(|| ts.clone());
    let finished = matches!(status, "done" | "failed" | "cancelled").then(|| ts.clone());
    con.execute(
        "UPDATE deep_fetch_requests SET status = ?1, last_error = ?2, started_at = COALESCE(started_at, ?3),
                finished_at = COALESCE(?4, finished_at) WHERE id = ?5",
        params![status, error.map(crate::mask::text), started, finished, id])?;
    Ok(())
}

pub fn set_deep_progress(con: &Connection, id: &str, progress: &serde_json::Value) -> AppResult<()> {
    con.execute("UPDATE deep_fetch_requests SET progress = ?1 WHERE id = ?2", params![progress.to_string(), id])?;
    Ok(())
}

/// "Last 2 AYs, index only" — the short human string on the client (§2.4).
pub fn history_note(req: &DeepFetchRequest) -> String {
    let depth = match req.depth.as_str() {
        "years" => format!("Last {} AYs", req.depth_value.as_deref().unwrap_or("?")),
        "since" => format!("Since {}", req.depth_value.as_deref().unwrap_or("?")),
        _ => "All assessment years".into(),
    };
    let docs = if req.docs_policy == "download" { "documents downloaded" } else { "index only" };
    format!("{depth}, {docs}")
}

/// On completion: depth, time and note on the client, written through the
/// ledger like any client edit.
pub fn record_history(con: &Connection, req: &DeepFetchRequest) -> AppResult<()> {
    let Some(mut c) = clients::get(con, &req.client_id)? else { return Ok(()); };
    let ts = now();
    // `partial` never demotes a client that already has its full history.
    let full = req.depth == "all" || c.history_depth.as_deref() == Some("full");
    let depth = if full { "full" } else { "partial" };
    c.history_depth = Some(depth.into());
    c.history_fetched_at = Some(ts.clone());
    c.history_note = Some(history_note(req));
    c.updated_at = ts;
    clients::save(con, &c)
}

/// How many work items the client now holds, for "History fetched · n items".
pub fn client_item_count(con: &Connection, client_id: &str) -> AppResult<i64> {
    Ok(con.query_row(
        "SELECT (SELECT count(*) FROM communications m JOIN proceedings p ON p.id = m.proceeding_id
                   JOIN year_contexts y ON y.id = p.year_context_id WHERE y.client_id = ?1)
              + (SELECT count(*) FROM demands d JOIN year_contexts y ON y.id = d.year_context_id WHERE y.client_id = ?1)
              + (SELECT count(*) FROM returns t JOIN year_contexts y ON y.id = t.year_context_id WHERE y.client_id = ?1)
              + (SELECT count(*) FROM filed_forms f JOIN year_contexts y ON y.id = f.year_context_id WHERE y.client_id = ?1)",
        [client_id], |r| r.get(0))?)
}

// ------------------------------------------------------- tier and pause

/// §2.5 after a client's sweep. `changed` is whether the sweep or probe
/// found anything. A pinned client stays nightly. Written only when the
/// tier or the swept time moves.
pub fn after_client_sweep(con: &Connection, client_id: &str, changed: bool, dormant_after_days: Option<u32>) -> AppResult<()> {
    let Some(mut c) = clients::get(con, client_id)? else { return Ok(()); };
    let ts = now();
    let current = c.cadence_tier.clone().unwrap_or_else(|| "nightly".into());
    let pinned = c.cadence_pinned.unwrap_or(0) == 1;
    let tier = if pinned || changed { "nightly".to_string() } else {
        match dormant_after_days {
            None => "nightly".into(),
            Some(days) if goes_dormant(con, client_id, days)? => "weekly".into(),
            Some(_) => current.clone(),
        }
    };
    c.cadence_tier = Some(tier);
    c.last_swept_at = Some(ts.clone());
    c.updated_at = ts;
    clients::save(con, &c)
}

/// No open items, nothing issued within `days`, no deep fetch queued.
fn goes_dormant(con: &Connection, client_id: &str, days: u32) -> AppResult<bool> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days as i64)).format("%Y-%m-%d").to_string();
    let busy: i64 = con.query_row(
        "SELECT (SELECT count(*) FROM proceedings p JOIN year_contexts y ON y.id = p.year_context_id
                  WHERE y.client_id = ?1 AND p.status IN ('open','adjournment_sought','unknown'))
              + (SELECT count(*) FROM communications m JOIN proceedings p ON p.id = m.proceeding_id
                   JOIN year_contexts y ON y.id = p.year_context_id
                  WHERE y.client_id = ?1 AND m.issued_on >= ?2)
              + (SELECT count(*) FROM deep_fetch_requests WHERE client_id = ?1 AND status IN ('queued','running'))",
        params![client_id, cutoff], |r| r.get(0))?;
    Ok(busy == 0)
}

pub fn set_client_sync(con: &Connection, client_id: &str, enabled: bool, reason: Option<&str>) -> AppResult<()> {
    let mut c = clients::get(con, client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    c.sync_enabled = Some(i64::from(enabled));
    // Cleared as an empty string so the clear is written (D-039).
    c.sync_pause_reason = Some(if enabled { String::new() } else {
        reason.map(str::trim).unwrap_or("").chars().take(200).collect()
    });
    c.updated_at = now();
    clients::save(con, &c)
}

pub fn pin_cadence(con: &Connection, client_id: &str, pinned: bool) -> AppResult<()> {
    let mut c = clients::get(con, client_id)?.ok_or_else(|| AppError::not_found("client"))?;
    c.cadence_pinned = Some(i64::from(pinned));
    if pinned { c.cadence_tier = Some("nightly".into()); }
    c.updated_at = now();
    clients::save(con, &c)
}

// -------------------------------------------------------------- estimates

fn median(mut v: Vec<f64>) -> Option<f64> {
    if v.is_empty() { return None; }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let m = v.len() / 2;
    Some(if v.len().is_multiple_of(2) { (v[m - 1] + v[m]) / 2.0 } else { v[m] })
}

/// Seconds each finished sweep spent on this client, newest first: all of
/// one sweep's jobs for the client added together. A probe-skip is its
/// real duration (a few seconds), which is what §2.9's 5 s stands for.
fn client_durations(con: &Connection, client_id: &str, kind: &str, limit: i64) -> AppResult<Vec<f64>> {
    let mut st = con.prepare(
        "SELECT sum((julianday(j.finished_at) - julianday(j.started_at)) * 86400.0)
           FROM ingestion_jobs j JOIN ingestion_sweeps s ON s.id = j.sweep_id
          WHERE j.client_id = ?1 AND j.status = 'done' AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
            AND coalesce(json_extract(s.scope, '$.kind'), 'sweep') = ?2
          GROUP BY j.sweep_id ORDER BY max(j.finished_at) DESC LIMIT ?3")?;
    let rows = st.query_map(params![client_id, kind, limit], |r| r.get::<_, Option<f64>>(0))?;
    Ok(rows.filter_map(|r| r.ok().flatten()).filter(|d| *d >= 0.0).collect())
}

fn firm_median(con: &Connection, kind: &str) -> AppResult<Option<f64>> {
    let mut st = con.prepare(
        "SELECT sum((julianday(j.finished_at) - julianday(j.started_at)) * 86400.0)
           FROM ingestion_jobs j JOIN ingestion_sweeps s ON s.id = j.sweep_id
          WHERE j.status = 'done' AND j.client_id IS NOT NULL AND j.started_at IS NOT NULL AND j.finished_at IS NOT NULL
            AND coalesce(json_extract(s.scope, '$.kind'), 'sweep') = ?1
          GROUP BY j.sweep_id, j.client_id ORDER BY max(j.finished_at) DESC LIMIT 500")?;
    let rows = st.query_map([kind], |r| r.get::<_, Option<f64>>(0))?;
    Ok(median(rows.filter_map(|r| r.ok().flatten()).collect()))
}

/// With no history anywhere, a first guess per client: login plus six
/// panels, index only.
const FIRST_GUESS_SECONDS: f64 = 60.0;

/// §2.9: Σ per client of the median of its last five sweeps, the firm
/// median below two. A label, never a gate.
pub fn sweep_estimate(con: &Connection, client_ids: &[String]) -> AppResult<i64> {
    let firm = firm_median(con, "sweep")?.unwrap_or(FIRST_GUESS_SECONDS);
    let mut total = 0.0;
    for id in client_ids {
        let d = client_durations(con, id, "sweep", 5)?;
        total += if d.len() >= 2 { median(d).unwrap_or(firm) } else { firm };
    }
    Ok(total.round() as i64)
}

/// Every sweep-enabled portal client (the `Sweep all now` label).
pub fn book_client_ids(con: &Connection) -> AppResult<Vec<String>> {
    let mut st = con.prepare("SELECT id FROM clients WHERE source = 'portal' AND sync_enabled = 1")?;
    let rows = st.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// §6.3: median deep duration × AY count when known, else 3× the sweep
/// median. The AY count is what the client holds now, at least one.
pub fn deep_estimate(con: &Connection, client_id: &str, depth: &str, depth_value: Option<&str>) -> AppResult<i64> {
    let deep = median(client_durations(con, client_id, "deep", 5)?).or(firm_median(con, "deep")?);
    let known_ays: i64 = con.query_row(
        "SELECT count(*) FROM year_contexts WHERE client_id = ?1 AND assessment_year IS NOT NULL", [client_id], |r| r.get(0))?;
    let ays = match depth {
        "years" => depth_value.and_then(|v| v.parse::<i64>().ok()).unwrap_or(1),
        _ => known_ays.max(1),
    }.max(1) as f64;
    let secs = match deep {
        // A past deep fetch covered roughly the AYs the client had then;
        // scale it per AY.
        Some(d) => d / (known_ays.max(1) as f64) * ays,
        None => 3.0 * sweep_estimate(con, &[client_id.to_string()])? as f64,
    };
    Ok(secs.round() as i64)
}

// -------------------------------------------------------------- item fetch

/// Where an item fetch goes and what it takes (docs/17 §3).
#[derive(Debug, Clone)]
pub struct ItemPlan {
    pub client_id: String,
    pub module: String,
    pub panel: String,
    /// Notice reference ids, or the acknowledgement number.
    pub targets: Vec<String>,
    pub proceeding: Option<crate::ingest::source::ProceedingTarget>,
}

pub fn item_plan(con: &Connection, module: &str, id: &str) -> AppResult<ItemPlan> {
    match module {
        "proceedings" => {
            let (name, ay, panel, client_id): (Option<String>, Option<String>, String, String) = con.query_row(
                "SELECT p.display_name, y.assessment_year, p.source_panel, c.id
                   FROM proceedings p JOIN year_contexts y ON y.id = p.year_context_id JOIN clients c ON c.id = y.client_id
                  WHERE p.id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
                .optional()?.ok_or_else(|| AppError::not_found("work item"))?;
            // The ones not yet stored; every notice when all are (a re-fetch).
            let refs = |sql: &str| -> AppResult<Vec<String>> {
                let mut st = con.prepare(sql)?;
                let rows = st.query_map([id], |r| r.get(0))?;
                Ok(rows.collect::<Result<_, _>>()?)
            };
            let mut targets = refs(
                "SELECT m.reference_id FROM communications m
                  WHERE m.proceeding_id = ?1 AND NOT EXISTS (
                        SELECT 1 FROM documents d WHERE d.parent_type = 'communication' AND d.parent_id = m.id
                           AND d.state = 'stored')")?;
            if targets.is_empty() {
                targets = refs("SELECT reference_id FROM communications WHERE proceeding_id = ?1")?;
            }
            if targets.is_empty() { return Err(AppError::state("this item has no notices to fetch")); }
            Ok(ItemPlan { client_id, module: module.into(), panel,
                          targets, proceeding: Some(crate::ingest::source::ProceedingTarget { proceeding_name: name, assessment_year: ay }) })
        }
        "returns" | "forms" => {
            let table = if module == "returns" { "returns" } else { "filed_forms" };
            let (ack, client_id): (Option<String>, String) = con.query_row(
                &format!("SELECT t.acknowledgement_number, c.id
                            FROM {table} t JOIN year_contexts y ON y.id = t.year_context_id JOIN clients c ON c.id = y.client_id
                           WHERE t.id = ?1"), [id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?.ok_or_else(|| AppError::not_found("work item"))?;
            let ack = ack.ok_or_else(|| AppError::state("this item has no acknowledgement number to find it by"))?;
            Ok(ItemPlan { client_id, module: module.into(), panel: module.into(), targets: vec![ack], proceeding: None })
        }
        _ => Err(AppError::state("demands carry no documents to fetch")),
    }
}

/// Pending documents of open items due within `days`, soonest first, as
/// (module, id) pairs (docs/17 §2.6 warm cache).
pub fn warm_candidates(con: &Connection, days: u32, today: chrono::NaiveDate) -> AppResult<Vec<(String, String)>> {
    let until = (today + chrono::Duration::days(days as i64)).format("%Y-%m-%d").to_string();
    let mut st = con.prepare(
        "SELECT p.id FROM proceedings p
          WHERE p.status IN ('open','adjournment_sought','unknown')
            AND coalesce(p.manual_due_date, p.due_date) IS NOT NULL
            AND coalesce(p.manual_due_date, p.due_date) <= ?1
            AND EXISTS (SELECT 1 FROM communications m JOIN documents d
                          ON d.parent_type = 'communication' AND d.parent_id = m.id
                        WHERE m.proceeding_id = p.id AND d.state = 'pending')
          ORDER BY coalesce(p.manual_due_date, p.due_date)")?;
    let rows = st.query_map([until], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(Result::ok).map(|id| ("proceedings".to_string(), id)).collect())
}

/// Index only (docs/17 §5): a `pending` row carries the portal reference
/// the item fetch will look for. A stored document is never demoted.
pub fn mark_pending(con: &Connection, parent_type: &str, parent_id: &str, doc_kind: &str, reference: &str) -> AppResult<()> {
    let mut d = crate::repo::documents::ensure_pending(con, parent_type, parent_id, doc_kind)?;
    if d.state == "stored" { return Ok(()); }
    let url = format!("portal:{parent_type}:{reference}");
    if d.state != "pending" || d.source_url.as_deref() != Some(url.as_str()) {
        d.state = "pending".into();
        d.source_url = Some(url);
        d.updated_at = now();
        crate::repo::rows::upsert(con, "documents", &d)?;
    }
    Ok(())
}

// ---------------------------------------------------- queued item fetches

const KEY_ITEM_QUEUE: &str = "item_fetch_queue";

/// Item fetches asked for while a sweep held the session: run after it.
pub fn queue_item_fetch(con: &Connection, module: &str, id: &str) -> AppResult<()> {
    let mut q = queued_item_fetches(con)?;
    if !q.iter().any(|(m, i)| m == module && i == id) { q.push((module.into(), id.into())); }
    crate::repo::local::set(con, KEY_ITEM_QUEUE, &serde_json::to_string(&q)?)
}

pub fn queued_item_fetches(con: &Connection) -> AppResult<Vec<(String, String)>> {
    Ok(crate::repo::local::get(con, KEY_ITEM_QUEUE)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn take_item_fetches(con: &Connection) -> AppResult<Vec<(String, String)>> {
    let q = queued_item_fetches(con)?;
    crate::repo::local::set(con, KEY_ITEM_QUEUE, "[]")?;
    Ok(q)
}
