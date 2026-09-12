//! Snapshots: the compacted state of every synced table plus the cursor
//! map it was taken at (docs/03). A new device loads the latest snapshot
//! and replays only the tail. Cadence per Q07: every 5,000 ledger entries
//! or every 7 days, whichever first.
//!
//! The snapshot is JSON rather than a second SQLite file (D-016): its rows
//! are the same payloads the ledger carries, so loading one is the same
//! merge as applying entries and there is no second schema to keep in step.

use crate::error::AppResult;
use crate::ledger::{self, CursorMap};
use crate::merge::{self, IdMap};
use crate::repo::local;
use crate::repo::rows::SYNCED_TABLES;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const SNAPSHOT_EVERY_ENTRIES: i64 = 5_000;
pub const SNAPSHOT_EVERY_DAYS: i64 = 7;

#[derive(Debug, Serialize, Deserialize)]
pub struct Version {
    pub entity_type: String,
    pub entity_id: String,
    pub updated_at: String,
    pub device_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub format: u32,
    pub taken_at: String,
    pub device_id: String,
    pub cursor: CursorMap,
    pub tables: BTreeMap<String, Vec<Value>>,
    pub versions: Vec<Version>,
}

pub fn build(con: &Connection) -> AppResult<Snapshot> {
    let mut tables = BTreeMap::new();
    for t in SYNCED_TABLES {
        let exists: bool = con.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [t],
                                         |r| r.get::<_, i64>(0))? > 0;
        if exists { tables.insert(t.to_string(), ledger::read_all_as_json(con, t)?); }
    }
    let mut st = con.prepare("SELECT entity_type, entity_id, updated_at, device_id FROM entity_versions")?;
    let versions = st.query_map([], |r| Ok(Version {
        entity_type: r.get(0)?, entity_id: r.get(1)?, updated_at: r.get(2)?, device_id: r.get(3)?,
    }))?.collect::<Result<Vec<_>, _>>()?;
    let snap = Snapshot {
        format: 1, taken_at: crate::ids::now(), device_id: local::device_id(con)?,
        cursor: ledger::full_cursor_map(con)?, tables, versions,
    };
    local::set(con, "last_snapshot_at", &snap.taken_at)?;
    let total: i64 = con.query_row("SELECT count(*) FROM ledger", [], |r| r.get(0))?;
    local::set(con, "last_snapshot_entries", &total.to_string())?;
    Ok(snap)
}

/// Q07: a new snapshot is due after 5,000 entries or 7 days.
pub fn due(con: &Connection) -> AppResult<bool> {
    let last_at = local::get(con, "last_snapshot_at")?;
    let last_entries: i64 = local::get(con, "last_snapshot_entries")?.and_then(|s| s.parse().ok()).unwrap_or(0);
    let total: i64 = con.query_row("SELECT count(*) FROM ledger", [], |r| r.get(0))?;
    if total - last_entries >= SNAPSHOT_EVERY_ENTRIES { return Ok(true); }
    match last_at.and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok()) {
        None => Ok(true),
        Some(t) => Ok(chrono::Utc::now().signed_duration_since(t).num_days() >= SNAPSHOT_EVERY_DAYS),
    }
}

#[derive(Debug, Default, Serialize)]
pub struct LoadReport {
    pub written: i64,
    pub kept_local: i64,
    pub errors: Vec<String>,
}

/// Merge a snapshot into this archive (a new device, or a bundle import).
/// Rows go through the same natural-key matching and last-write-wins as
/// ledger entries; the cursor map advances to the snapshot's positions.
pub fn load(con: &mut Connection, snap: &Snapshot) -> AppResult<LoadReport> {
    let mut report = LoadReport::default();
    let versions: BTreeMap<(String, String), (String, String)> = snap.versions.iter()
        .map(|v| ((v.entity_type.clone(), v.entity_id.clone()), (v.updated_at.clone(), v.device_id.clone())))
        .collect();
    let mut idmap = IdMap::new();
    let tx = con.transaction()?;
    for table in merge::ORDER {
        let Some(rows) = snap.tables.get(*table) else { continue; };
        for row in rows {
            let id = row.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            let (updated_at, device) = versions.get(&(table.to_string(), id.clone())).cloned()
                .unwrap_or_else(|| (row.get("updated_at").and_then(Value::as_str).unwrap_or("").to_string(), snap.device_id.clone()));
            match merge::merge_row(&tx, table, row.clone(), (&updated_at, &device), &mut idmap) {
                Ok(true) => report.written += 1,
                Ok(false) => report.kept_local += 1,
                Err(e) => report.errors.push(format!("{table} {id}: {e}")),
            }
        }
    }
    let own = local::device_id(&tx)?;
    let current = ledger::cursor_map(&tx)?;
    for (device, seq) in &snap.cursor {
        if *device == own { continue; }
        if *seq > *current.get(device).unwrap_or(&0) { ledger::set_cursor(&tx, device, *seq)?; }
    }
    tx.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::clients;

    fn fresh(device: &str) -> Connection {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        local::set(&con, local::DEVICE_ID, device).unwrap();
        con
    }

    /// docs/12: a new device from snapshot plus tail matches a device that
    /// replayed everything.
    #[test]
    fn snapshot_plus_tail_matches_full_replay() {
        let a = fresh("dev_a");
        for i in 0..4 { clients::create_minimal(&a, &format!("ABCDE12{i:02}F"), Some("Example")).unwrap(); }
        let snap = build(&a).unwrap();
        // more writes after the snapshot
        for i in 4..7 { clients::create_minimal(&a, &format!("ABCDE12{i:02}F"), Some("Example")).unwrap(); }
        let all = ledger::entries_after(&a, "dev_a", 0).unwrap();
        let tail = ledger::tail(&a, &snap.cursor).unwrap();
        assert!(tail.len() < all.len());

        let mut full = fresh("dev_full");
        ledger::apply(&mut full, &all).unwrap();
        let mut fast = fresh("dev_fast");
        load(&mut fast, &snap).unwrap();
        ledger::apply(&mut fast, &tail).unwrap();

        assert_eq!(ledger::read_all_as_json(&full, "clients").unwrap(), ledger::read_all_as_json(&fast, "clients").unwrap());
        // (the seed stream minted by migration 0015 rides along in the
        // snapshot's cursor; the stream under test is dev_a's)
        assert_eq!(ledger::cursor_map(&full).unwrap()["dev_a"], ledger::cursor_map(&fast).unwrap()["dev_a"]);
    }
}
