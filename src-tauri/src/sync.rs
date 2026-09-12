//! The sync engine (docs/03, docs/09): push this device's unpublished
//! entries, pull everything after the cursor map, apply, and keep the two
//! independent facts the screen must never collapse — how far behind, and
//! when the collector last reported.

use crate::error::{AppError, AppResult};
use crate::ids::now;
use crate::ledger::{self, CursorMap};
use crate::relay::{self, Relay};
use crate::repo::local;
use crate::snapshot;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// A collector that has not reported for this long has missed a daily run
/// (Q12 default) plus a grace period; the screen warns (Q17).
pub const COLLECTOR_SILENT_HOURS: i64 = 26;

#[derive(Debug, Clone, Serialize, Default)]
pub struct SyncState {
    pub configured: bool,
    pub firm_id: Option<String>,
    pub firm_name: Option<String>,
    pub device_id: String,
    pub permission: Option<String>,
    pub cursor: CursorMap,
    pub heads: CursorMap,
    /// Entries this device has not applied, by originating device.
    pub behind_by_device: BTreeMap<String, i64>,
    pub behind_total: i64,
    pub unpublished: i64,
    pub unpublished_sweep_waiting: bool,
    pub collector_device_id: Option<String>,
    pub collector_last_seen: Option<String>,
    pub collector_silent: bool,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    /// `up_to_date` | `behind` | `unreachable` | `not_configured`
    pub status: String,
}

pub fn state(con: &Connection) -> AppResult<SyncState> {
    let cfg = relay::config(con)?;
    let device_id = local::device_id(con)?;
    let cursor = ledger::full_cursor_map(con)?;
    let heads: CursorMap = local::get(con, relay::KEY_HEADS)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut behind = BTreeMap::new();
    for (d, h) in &heads {
        if *d == device_id { continue; }
        let gap = h - cursor.get(d).unwrap_or(&0);
        if gap > 0 { behind.insert(d.clone(), gap); }
    }
    let behind_total = behind.values().sum();
    let published: i64 = local::get(con, relay::KEY_PUBLISHED)?.and_then(|s| s.parse().ok()).unwrap_or(0);
    let own_head = *cursor.get(&device_id).unwrap_or(&0);
    let collector_last_seen = local::get(con, relay::KEY_COLLECTOR_SEEN)?;
    let collector_silent = match collector_last_seen.as_deref().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) {
        Some(t) => chrono::Utc::now().signed_duration_since(t).num_hours() >= COLLECTOR_SILENT_HOURS,
        None => cfg.is_some(),
    };
    let last_error = local::get(con, relay::KEY_LAST_ERROR)?;
    let status = if cfg.is_none() { "not_configured" }
        else if last_error.as_deref().map(|e| e.contains("cannot reach")).unwrap_or(false) { "unreachable" }
        else if behind_total > 0 { "behind" } else { "up_to_date" };
    Ok(SyncState {
        configured: cfg.is_some(),
        firm_id: cfg.as_ref().map(|c| c.firm_id.clone()),
        firm_name: cfg.as_ref().and_then(|c| c.firm_name.clone()),
        permission: local::get(con, relay::KEY_PERMISSION)?,
        device_id, cursor, heads, behind_by_device: behind, behind_total,
        unpublished: (own_head - published).max(0),
        unpublished_sweep_waiting: local::get(con, "relay_sweep_waiting")?.as_deref() == Some("1"),
        collector_device_id: local::get(con, relay::KEY_COLLECTOR_ID)?,
        collector_last_seen, collector_silent,
        last_sync_at: local::get(con, relay::KEY_LAST_SYNC)?,
        last_error, status: status.into(),
    })
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SyncResult {
    pub pushed: i64,
    pub pulled: i64,
    pub applied: i64,
    pub snapshot_published: bool,
    pub sweep_waiting_for_lease: bool,
    pub errors: Vec<String>,
}

/// Push, pull, apply. The archive lock is taken per step so the UI stays
/// responsive during a long pull.
pub async fn sync_now(db: &Arc<Mutex<Connection>>) -> AppResult<SyncResult> {
    let (cfg, device_id) = {
        let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
        (relay::require_config(&con)?, local::device_id(&con)?)
    };
    let relay = Relay::new(cfg);
    let mut result = SyncResult::default();
    let outcome = run(&relay, db, &device_id, &mut result).await;
    let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
    match &outcome {
        Ok(()) => { local::set(&con, relay::KEY_LAST_ERROR, "")?; local::set(&con, relay::KEY_LAST_SYNC, &now())?; }
        Err(e) => { local::set(&con, relay::KEY_LAST_ERROR, &e.to_string())?; }
    }
    local::set(&con, "relay_sweep_waiting", if result.sweep_waiting_for_lease { "1" } else { "0" })?;
    outcome.map(|_| result)
}

async fn run(relay: &Relay, db: &Arc<Mutex<Connection>>, device_id: &str, result: &mut SyncResult) -> AppResult<()> {
    // ---- push: contiguous runs of the same kind, in order
    loop {
        let (published, entries) = {
            let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
            let published: i64 = local::get(&con, relay::KEY_PUBLISHED)?.and_then(|s| s.parse().ok()).unwrap_or(0);
            (published, ledger::entries_after(&con, device_id, published)?)
        };
        let Some(first) = entries.first() else { break; };
        let kind = first.source.clone();
        let run: Vec<_> = entries.iter().take_while(|e| e.source == kind).take(500).cloned().collect();
        let publish_kind = if kind == "sweep" { "sweep" } else { "user" };
        match relay.publish(&run, publish_kind).await {
            Ok(()) => {
                let last = run.last().map(|e| e.seq).unwrap_or(published);
                let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
                local::set(&con, relay::KEY_PUBLISHED, &last.to_string())?;
                result.pushed += run.len() as i64;
            }
            Err(AppError::Proxy { message }) if publish_kind == "sweep" && message.contains("403") => {
                // Sweep entries wait for the lease; nothing after them can
                // go (streams are contiguous), so stop pushing for now.
                result.sweep_waiting_for_lease = true;
                break;
            }
            Err(e) => return Err(e),
        }
    }

    // ---- pull and apply, page by page
    loop {
        let cursor = { let con = db.lock().map_err(|e| AppError::state(e.to_string()))?; ledger::full_cursor_map(&con)? };
        let fetched = relay.fetch(&cursor).await?;
        {
            let mut con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
            local::set(&con, relay::KEY_HEADS, &serde_json::to_string(&fetched.heads)?)?;
            if let Some((id, seen)) = &fetched.collector {
                local::set(&con, relay::KEY_COLLECTOR_ID, id)?;
                if let Some(s) = seen { local::set(&con, relay::KEY_COLLECTOR_SEEN, s)?; }
            }
            if !fetched.entries.is_empty() {
                result.pulled += fetched.entries.len() as i64;
                let report = ledger::apply(&mut con, &fetched.entries)?;
                result.applied += report.applied;
                result.errors.extend(report.errors);
            }
        }
        if !fetched.more { break; }
    }
    Ok(())
}

/// The push half alone — what a removed device is still allowed to do.
pub async fn push_only(db: &Arc<Mutex<Connection>>) -> AppResult<i64> {
    let (cfg, device_id) = {
        let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
        (relay::require_config(&con)?, local::device_id(&con)?)
    };
    let relay = Relay::new(cfg);
    let mut pushed = 0i64;
    loop {
        let (published, entries) = {
            let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
            let published: i64 = local::get(&con, relay::KEY_PUBLISHED)?.and_then(|s| s.parse().ok()).unwrap_or(0);
            (published, ledger::entries_after(&con, device_id.as_str(), published)?)
        };
        let Some(first) = entries.first() else { break; };
        let kind = first.source.clone();
        let run: Vec<_> = entries.iter().take_while(|e| e.source == kind).take(500).cloned().collect();
        if kind == "sweep" { break; }     // never publishable without the lease
        relay.publish(&run, "user").await?;
        let last = run.last().map(|e| e.seq).unwrap_or(published);
        let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
        local::set(&con, relay::KEY_PUBLISHED, &last.to_string())?;
        pushed += run.len() as i64;
    }
    Ok(pushed)
}

/// First sync of a freshly enrolled device: the latest snapshot, then the
/// tail. Without this, onboarding replays the whole history.
pub async fn bootstrap_from_snapshot(db: &Arc<Mutex<Connection>>) -> AppResult<bool> {
    let cfg = { let con = db.lock().map_err(|e| AppError::state(e.to_string()))?; relay::require_config(&con)? };
    let relay = Relay::new(cfg);
    let Some(bytes) = relay.latest_snapshot().await? else { return Ok(false); };
    let snap: snapshot::Snapshot = serde_json::from_slice(&bytes)?;
    let mut con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
    snapshot::load(&mut con, &snap)?;
    Ok(true)
}

/// The collector publishes a snapshot when one is due (Q07).
pub async fn publish_snapshot_if_due(db: &Arc<Mutex<Connection>>) -> AppResult<bool> {
    let (cfg, due, snap) = {
        let con = db.lock().map_err(|e| AppError::state(e.to_string()))?;
        let cfg = relay::require_config(&con)?;
        let due = snapshot::due(&con)?;
        (cfg, due, if due { Some(snapshot::build(&con)?) } else { None })
    };
    let Some(snap) = snap else { return Ok(false); };
    if !due { return Ok(false); }
    let relay = Relay::new(cfg);
    relay.publish_snapshot(&serde_json::to_vec(&snap)?, &snap.cursor).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::{self, Relay};
    use crate::repo::clients;

    fn fresh(device: &str) -> Arc<Mutex<Connection>> {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        local::set(&con, local::DEVICE_ID, device).unwrap();
        Arc::new(Mutex::new(con))
    }

    /// Against a running relay (`RELAY_URL=http://127.0.0.1:8790 cargo test
    /// relay_round_trip -- --ignored`): register, invite, enrol, push from
    /// one device, pull on the other, nominate and claim the lease.
    #[tokio::test]
    #[ignore]
    async fn relay_round_trip() {
        let Ok(url) = std::env::var("RELAY_URL") else { return; };
        let a = fresh(&format!("dev_a_{}", &crate::ids::new_id()[..8]));
        let b = fresh(&format!("dev_b_{}", &crate::ids::new_id()[..8]));
        let (id_a, id_b) = (local::device_id(&a.lock().unwrap()).unwrap(), local::device_id(&b.lock().unwrap()).unwrap());

        let e = Relay::register_firm(&url, &id_a, "Example & Co", "Laptop A", None).await.unwrap();
        assert!(!e.recovery_code.is_empty());
        relay::store_enrolment(&a.lock().unwrap(), &e).unwrap();
        let ra = Relay::new(e.config.clone());
        let invite = ra.create_invite().await.unwrap();

        let eb = Relay::enrol(&url, &id_b, &invite, "Laptop B", None).await.unwrap();
        relay::store_enrolment(&b.lock().unwrap(), &eb).unwrap();

        // A writes a client and syncs; B syncs and has it.
        clients::create_minimal(&a.lock().unwrap(), "ABCDE1234F", Some("Example")).unwrap();
        let ra_res = sync_now(&a).await.unwrap();
        assert!(ra_res.pushed >= 1, "{ra_res:?}");
        let rb_res = sync_now(&b).await.unwrap();
        assert!(rb_res.applied >= 1, "{rb_res:?}");
        assert!(clients::find_by_pan(&b.lock().unwrap(), "ABCDE1234F").unwrap().is_some());
        let st = state(&b.lock().unwrap()).unwrap();
        assert_eq!(st.status, "up_to_date");

        // lease: not nominated -> refused; nominated -> held; the roster shows it
        let rb = Relay::new(eb.config.clone());
        assert!(rb.claim_lease().await.is_err());
        ra.set_collector(&id_b).await.unwrap();
        assert!(rb.claim_lease().await.unwrap());
        let roster = ra.roster().await.unwrap();
        assert_eq!(roster.lease.unwrap()["device_id"], id_b);
        assert!(rb.acquire_lock("ABCDE1234F").await.unwrap());
        assert!(!ra.acquire_lock("ABCDE1234F").await.unwrap());
        rb.release_lock("ABCDE1234F").await.unwrap();
        rb.release_lease().await.unwrap();
    }
}
