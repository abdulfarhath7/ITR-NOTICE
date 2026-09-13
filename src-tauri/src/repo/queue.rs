//! The ingestion queue: sweeps, jobs with attempts, backoff and a resume
//! cursor, and the per-login session lock (docs/05, tasks 4.2 and 4.5).

use crate::error::{AppError, AppResult};
use crate::ids::{new_id, now};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const MODULES: &[&str] = &["proceedings", "demands", "returns", "forms"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Scope {
    All,
    Module { module: String },
    Client { client_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sweep {
    pub id: String,
    pub device_id: String,
    pub scope: String,
    pub status: String,
    pub operator: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub sweep_id: String,
    pub login_ref: String,
    pub client_id: Option<String>,
    pub module: String,
    pub position: i64,
    pub status: String,
    pub attempts: i64,
    pub next_attempt_at: Option<String>,
    pub cursor: Option<String>,
    pub last_error: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Cursor {
    pub panels_done: Vec<String>,
}

impl Job {
    pub fn cursor(&self) -> Cursor {
        self.cursor.as_deref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default()
    }
}

fn job_row(r: &Row) -> rusqlite::Result<Job> {
    Ok(Job {
        id: r.get("id")?, sweep_id: r.get("sweep_id")?, login_ref: r.get("login_ref")?,
        client_id: r.get("client_id")?, module: r.get("module")?, position: r.get("position")?,
        status: r.get("status")?, attempts: r.get("attempts")?, next_attempt_at: r.get("next_attempt_at")?,
        cursor: r.get("cursor")?, last_error: r.get("last_error")?, started_at: r.get("started_at")?,
        finished_at: r.get("finished_at")?, created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

fn sweep_row(r: &Row) -> rusqlite::Result<Sweep> {
    Ok(Sweep {
        id: r.get("id")?, device_id: r.get("device_id")?, scope: r.get("scope")?, status: r.get("status")?,
        operator: r.get("operator")?, started_at: r.get("started_at")?, finished_at: r.get("finished_at")?,
        created_at: r.get("created_at")?,
    })
}

/// Build the queue for a scope: one job per login per module. Clients
/// reached through the same AR login share one job, because that login's
/// panels list all of them.
pub fn create_sweep(con: &Connection, device_id: &str, scope: &Scope, modules: &[&str]) -> AppResult<Sweep> {
    let (sql, bind): (&str, Option<String>) = match scope {
        Scope::All | Scope::Module { .. } =>
            ("SELECT id, pan, portal_login_ref FROM clients WHERE source = 'portal' ORDER BY name COLLATE NOCASE", None),
        Scope::Client { client_id } =>
            ("SELECT id, pan, portal_login_ref FROM clients WHERE id = ?1", Some(client_id.clone())),
    };
    let mut st = con.prepare(sql)?;
    let rows: Vec<(String, String, Option<String>)> = match &bind {
        Some(b) => st.query_map([b], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?,
        None => st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?,
    };
    if rows.is_empty() {
        return Err(AppError::state("no portal-source clients to sweep"));
    }
    let ts = now();
    let sweep = Sweep {
        id: new_id(), device_id: device_id.into(), scope: serde_json::to_string(scope)?,
        status: "running".into(), operator: None, started_at: ts.clone(), finished_at: None, created_at: ts.clone(),
    };
    con.execute(
        "INSERT INTO ingestion_sweeps (id, device_id, scope, status, operator, started_at, finished_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![sweep.id, sweep.device_id, sweep.scope, sweep.status, sweep.operator, sweep.started_at,
                sweep.finished_at, sweep.created_at])?;
    // One job per distinct login per module, in book order.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut position = 0i64;
    for (client_id, pan, login_ref) in rows {
        let login = login_ref.unwrap_or(pan);
        if !seen.insert(login.clone()) { continue; }
        // The login's own client, when the login is a client in the book.
        let owner: Option<String> = con.prepare_cached("SELECT id FROM clients WHERE pan = ?1")?
            .query_row([&login], |r| r.get(0)).optional()?.or(Some(client_id));
        for module in modules {
            position += 1;
            con.execute(
                "INSERT INTO ingestion_jobs (id, sweep_id, login_ref, client_id, module, position, status,
                                             attempts, cursor, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', 0, NULL, ?7, ?7)",
                params![new_id(), sweep.id, login, owner, module, position, ts])?;
        }
    }
    Ok(sweep)
}

pub fn sweep(con: &Connection, id: &str) -> AppResult<Option<Sweep>> {
    Ok(con.query_row("SELECT * FROM ingestion_sweeps WHERE id = ?1", [id], sweep_row).optional()?)
}

pub fn set_sweep_status(con: &Connection, id: &str, status: &str) -> AppResult<()> {
    let finished = matches!(status, "done" | "stopped" | "failed").then(now);
    con.execute("UPDATE ingestion_sweeps SET status = ?1, finished_at = COALESCE(?2, finished_at) WHERE id = ?3",
                params![status, finished, id])?;
    Ok(())
}

/// A sweep left `running` by a killed process. Its jobs keep their
/// cursors; the runner picks up at the next panel.
pub fn unfinished_sweep(con: &Connection) -> AppResult<Option<Sweep>> {
    Ok(con.query_row(
        "SELECT * FROM ingestion_sweeps WHERE status IN ('running','paused') ORDER BY started_at DESC LIMIT 1",
        [], sweep_row).optional()?)
}

pub fn jobs(con: &Connection, sweep_id: &str) -> AppResult<Vec<Job>> {
    let mut st = con.prepare("SELECT * FROM ingestion_jobs WHERE sweep_id = ?1 ORDER BY position")?;
    let rows = st.query_map([sweep_id], job_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// The next job to run: queued, or left running / awaiting by a killed
/// process (nothing else holds `running` across restarts), in order,
/// whose backoff has elapsed. A live run claims a job by setting it
/// `running` under the archive lock, so workers never share one.
pub fn next_job(con: &Connection, sweep_id: &str) -> AppResult<Option<Job>> {
    Ok(con.query_row(
        "SELECT * FROM ingestion_jobs WHERE sweep_id = ?1
           AND (status = 'queued'
                OR (status IN ('running','awaiting_operator') AND started_at IS NULL))
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?2)
         ORDER BY position LIMIT 1",
        params![sweep_id, now()], job_row).optional()?)
}

pub fn pending_count(con: &Connection, sweep_id: &str) -> AppResult<(i64, i64)> {
    Ok(con.query_row(
        "SELECT (SELECT count(*) FROM ingestion_jobs WHERE sweep_id = ?1 AND status IN ('queued','running','awaiting_operator')),
                (SELECT count(*) FROM ingestion_jobs WHERE sweep_id = ?1)",
        [sweep_id], |r| Ok((r.get(0)?, r.get(1)?)))?)
}

pub fn set_job_status(con: &Connection, id: &str, status: &str, error: Option<&str>) -> AppResult<()> {
    let ts = now();
    let started = (status == "started").then(|| ts.clone());
    let status = if status == "started" { "running" } else { status };
    let finished = matches!(status, "done" | "incomplete" | "failed" | "parked" | "cancelled").then(|| ts.clone());
    con.execute(
        "UPDATE ingestion_jobs SET status = ?1, last_error = COALESCE(?2, last_error),
                started_at = COALESCE(started_at, ?3), finished_at = COALESCE(?4, finished_at), updated_at = ?5
         WHERE id = ?6",
        params![status, error, started, finished, ts, id])?;
    Ok(())
}

/// Backoff: 5 min, then 30 min, then 2 h. A fourth failure parks the job.
pub fn schedule_retry(con: &Connection, job: &Job, error: &str) -> AppResult<()> {
    let attempts = job.attempts + 1;
    let delay_min = match attempts { 1 => 5, 2 => 30, 3 => 120, _ => 0 };
    let status = if delay_min == 0 { "parked" } else { "queued" };
    let next = (delay_min > 0).then(|| {
        (chrono::Utc::now() + chrono::Duration::minutes(delay_min)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
    });
    con.execute(
        "UPDATE ingestion_jobs SET status = ?1, attempts = ?2, next_attempt_at = ?3, last_error = ?4, updated_at = ?5
         WHERE id = ?6",
        params![status, attempts, next, error, now(), job.id])?;
    Ok(())
}

pub fn save_cursor(con: &Connection, id: &str, cursor: &Cursor) -> AppResult<()> {
    con.execute("UPDATE ingestion_jobs SET cursor = ?1, updated_at = ?2 WHERE id = ?3",
                params![serde_json::to_string(cursor)?, now(), id])?;
    Ok(())
}

pub fn cancel_open_jobs(con: &Connection, sweep_id: &str) -> AppResult<()> {
    con.execute(
        "UPDATE ingestion_jobs SET status = 'cancelled', finished_at = ?1, updated_at = ?1
         WHERE sweep_id = ?2 AND status IN ('queued','running','awaiting_operator')",
        params![now(), sweep_id])?;
    Ok(())
}

// ------------------------------------------------------------ session lock

pub const LOCK_SECONDS: i64 = 5 * 60;

fn lock_expiry() -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(LOCK_SECONDS)).format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Acquire or renew. Refused when another holder's lock is still live —
/// the requester must wait or report "in use", never proceed anyway.
pub fn acquire_lock(con: &Connection, login_ref: &str, holder: &str) -> AppResult<bool> {
    let ts = now();
    let existing: Option<(String, String)> = con.query_row(
        "SELECT holder, expires_at FROM session_locks WHERE login_ref = ?1", [login_ref],
        |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    if let Some((h, exp)) = existing {
        if h != holder && exp > ts {
            return Ok(false);
        }
    }
    con.execute(
        "INSERT INTO session_locks (login_ref, holder, acquired_at, expires_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(login_ref) DO UPDATE SET holder = excluded.holder, acquired_at = excluded.acquired_at,
                                             expires_at = excluded.expires_at",
        params![login_ref, holder, ts, lock_expiry()])?;
    Ok(true)
}

pub fn renew_lock(con: &Connection, login_ref: &str, holder: &str) -> AppResult<bool> {
    let n = con.execute("UPDATE session_locks SET expires_at = ?1 WHERE login_ref = ?2 AND holder = ?3",
                        params![lock_expiry(), login_ref, holder])?;
    Ok(n == 1)
}

pub fn release_lock(con: &Connection, login_ref: &str, holder: &str) -> AppResult<()> {
    con.execute("DELETE FROM session_locks WHERE login_ref = ?1 AND holder = ?2", params![login_ref, holder])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lock_is_exclusive_and_renewable() {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        assert!(acquire_lock(&con, "ABCDE1234F", "dev_a").unwrap());
        assert!(!acquire_lock(&con, "ABCDE1234F", "dev_b").unwrap(), "a live lock is refused");
        assert!(renew_lock(&con, "ABCDE1234F", "dev_a").unwrap());
        assert!(!renew_lock(&con, "ABCDE1234F", "dev_b").unwrap());
        release_lock(&con, "ABCDE1234F", "dev_a").unwrap();
        assert!(acquire_lock(&con, "ABCDE1234F", "dev_b").unwrap());
    }
}

/// Put jobs for these logins at the front of a sweep (refresh requests the
/// collector picked up from the relay).
pub fn prepend_jobs(con: &Connection, sweep_id: &str, logins: &[(String, Option<String>)], modules: &[&str]) -> AppResult<usize> {
    if logins.is_empty() { return Ok(0); }
    let ts = now();
    let mut position: i64 = con.query_row("SELECT COALESCE(MIN(position), 1) FROM ingestion_jobs WHERE sweep_id = ?1", [sweep_id], |r| r.get(0))?;
    let mut n = 0;
    for (login, client_id) in logins {
        let exists: i64 = con.query_row(
            "SELECT count(*) FROM ingestion_jobs WHERE sweep_id = ?1 AND login_ref = ?2 AND status IN ('queued','running')",
            params![sweep_id, login], |r| r.get(0))?;
        if exists > 0 { continue; }
        for module in modules {
            position -= 1;
            con.execute(
                "INSERT INTO ingestion_jobs (id, sweep_id, login_ref, client_id, module, position, status, attempts, cursor, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', 0, NULL, ?7, ?7)",
                params![new_id(), sweep_id, login, client_id, module, position, ts])?;
            n += 1;
        }
    }
    Ok(n)
}

/// At launch, any job a previous process left `running` or awaiting is
/// stale (one runner per sweep): back to `queued`, cursor intact, so the
/// run continues at that job's next panel (task 4.9).
pub fn requeue_interrupted(con: &Connection, sweep_id: &str) -> AppResult<usize> {
    let n = con.execute(
        "UPDATE ingestion_jobs SET status = 'queued', started_at = NULL, updated_at = ?1
         WHERE sweep_id = ?2 AND status IN ('running','awaiting_operator')",
        params![now(), sweep_id])?;
    Ok(n)
}
