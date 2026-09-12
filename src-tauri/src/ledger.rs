//! The change ledger and its apply logic (docs/03-sync-and-ledger.md).
//!
//! Every local write to a synced table appends an entry to this device's
//! stream in the same transaction (`after_write`, called from `rows`).
//! `apply` replays entries from other devices: idempotent, order-safe within
//! a stream, resumable mid-changeset, last-write-wins per row on
//! `updated_at` with `device_id` as the tiebreaker.

use crate::error::{AppError, AppResult};
use crate::ids::now;
use crate::migrate::MigrateError;
use crate::repo::local;
use crate::repo::rows::{self, Origin, SYNCED_TABLES};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub device_id: String,
    pub seq: i64,
    pub op: String,
    pub entity_type: String,
    pub entity_id: String,
    pub payload: Value,
    pub created_at: String,
}

/// `{ "dev_a": 41880, "dev_b": 19 }` — last applied seq per device.
pub type CursorMap = BTreeMap<String, i64>;

fn next_seq(con: &Connection, device_id: &str) -> AppResult<i64> {
    Ok(con.query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM ledger WHERE device_id = ?1", [device_id], |r| r.get(0))?)
}

/// Called by `rows` after every write to a synced table.
pub fn after_write(con: &Connection, table: &str, id: &str, op: &str, payload: &Value, updated_at: &str,
                   origin: Origin) -> AppResult<()> {
    let device_id = match origin {
        Origin::Local => {
            let device_id = local::device_id(con)?;
            let seq = next_seq(con, &device_id)?;
            con.execute(
                "INSERT INTO ledger (device_id, seq, op, entity_type, entity_id, payload, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![device_id, seq, op, table, id, payload.to_string(), now()])?;
            device_id
        }
        Origin::Replay { device_id } => device_id.to_string(),
    };
    con.execute(
        "INSERT INTO entity_versions (entity_type, entity_id, updated_at, device_id) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET updated_at = excluded.updated_at, device_id = excluded.device_id",
        params![table, id, updated_at, device_id])?;
    Ok(())
}

pub fn cursor_map(con: &Connection) -> AppResult<CursorMap> {
    let mut st = con.prepare("SELECT device_id, seq FROM sync_cursors")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    Ok(rows.collect::<Result<BTreeMap<_, _>, _>>()?)
}

/// This device's own stream position counts as "applied" too, so a cursor
/// map sent to the relay asks only for what is genuinely new.
pub fn full_cursor_map(con: &Connection) -> AppResult<CursorMap> {
    let mut map = cursor_map(con)?;
    let mut st = con.prepare("SELECT device_id, MAX(seq) FROM ledger GROUP BY device_id")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (d, s) = row?;
        let e = map.entry(d).or_insert(0);
        if s > *e { *e = s; }
    }
    Ok(map)
}

pub fn set_cursor(con: &Connection, device_id: &str, seq: i64) -> AppResult<()> {
    con.execute(
        "INSERT INTO sync_cursors (device_id, seq, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(device_id) DO UPDATE SET seq = excluded.seq, updated_at = excluded.updated_at",
        params![device_id, seq, now()])?;
    Ok(())
}

/// Entries this device has written after `after` (for publishing).
pub fn entries_after(con: &Connection, device_id: &str, after: i64) -> AppResult<Vec<Entry>> {
    let mut st = con.prepare(
        "SELECT device_id, seq, op, entity_type, entity_id, payload, created_at FROM ledger
         WHERE device_id = ?1 AND seq > ?2 ORDER BY seq")?;
    let rows = st.query_map(params![device_id, after], entry_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Every entry on this device, from every stream, after the cursor map.
pub fn tail(con: &Connection, after: &CursorMap) -> AppResult<Vec<Entry>> {
    let mut st = con.prepare(
        "SELECT device_id, seq, op, entity_type, entity_id, payload, created_at FROM ledger ORDER BY device_id, seq")?;
    let rows = st.query_map([], entry_row)?;
    let mut out = Vec::new();
    for row in rows {
        let e = row?;
        if e.seq > *after.get(&e.device_id).unwrap_or(&0) { out.push(e); }
    }
    Ok(out)
}

fn entry_row(r: &rusqlite::Row) -> rusqlite::Result<Entry> {
    let payload: String = r.get(5)?;
    Ok(Entry {
        device_id: r.get(0)?, seq: r.get(1)?, op: r.get(2)?, entity_type: r.get(3)?, entity_id: r.get(4)?,
        payload: serde_json::from_str(&payload).unwrap_or(Value::Null), created_at: r.get(6)?,
    })
}

/// Does `incoming` win over what is stored? Last write wins on
/// `updated_at`; equal timestamps go to the higher device id, so every
/// device picks the same winner.
pub fn incoming_wins(con: &Connection, entity_type: &str, entity_id: &str, updated_at: &str, device_id: &str) -> AppResult<bool> {
    let current: Option<(String, String)> = con.query_row(
        "SELECT updated_at, device_id FROM entity_versions WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    Ok(match current {
        None => true,
        Some((cur_at, cur_dev)) => (updated_at, device_id) > (cur_at.as_str(), cur_dev.as_str()),
    })
}

#[derive(Debug, Default, Serialize)]
pub struct ApplyReport {
    pub applied: i64,
    pub skipped_seen: i64,
    pub skipped_lost: i64,
    pub errors: Vec<String>,
}

/// Apply a changeset. Each entry commits with its cursor advance in one
/// transaction, so an interruption anywhere resumes exactly there; an
/// entry at or below the cursor is a no-op (idempotent); streams may
/// interleave, within a stream the caller keeps seq order (sorted here
/// regardless).
pub fn apply(con: &mut Connection, entries: &[Entry]) -> AppResult<ApplyReport> {
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by(|a, b| a.device_id.cmp(&b.device_id).then(a.seq.cmp(&b.seq)));
    let own = local::device_id(con)?;
    let mut report = ApplyReport::default();
    for e in sorted {
        if e.device_id == own {
            // Our own stream comes back from the relay; it is already here.
            report.skipped_seen += 1;
            continue;
        }
        let tx = con.transaction()?;
        let cursor: i64 = tx.query_row("SELECT COALESCE((SELECT seq FROM sync_cursors WHERE device_id = ?1), 0)",
                                       [&e.device_id], |r| r.get(0))?;
        if e.seq <= cursor {
            report.skipped_seen += 1;
            continue;
        }
        match apply_one(&tx, e) {
            Ok(true) => report.applied += 1,
            Ok(false) => report.skipped_lost += 1,
            Err(err) => {
                report.errors.push(format!("{}#{} {}: {err}", e.device_id, e.seq, e.entity_type));
            }
        }
        set_cursor(&tx, &e.device_id, e.seq)?;
        tx.commit()?;
    }
    Ok(report)
}

fn apply_one(tx: &Transaction, e: &Entry) -> AppResult<bool> {
    if !SYNCED_TABLES.contains(&e.entity_type.as_str()) {
        return Err(AppError::invalid(format!("not a synced table: {}", e.entity_type)));
    }
    let updated_at = e.payload.get("updated_at").and_then(Value::as_str).unwrap_or(&e.created_at).to_string();
    if !incoming_wins(tx, &e.entity_type, &e.entity_id, &updated_at, &e.device_id)? {
        return Ok(false);
    }
    let origin = Origin::Replay { device_id: &e.device_id };
    match e.op.as_str() {
        "upsert" => rows::write_value(tx, &e.entity_type, &e.payload, origin)?,
        "delete" => rows::delete_with(tx, &e.entity_type, &e.entity_id, origin)?,
        other => return Err(AppError::invalid(format!("unknown op {other}"))),
    }
    Ok(true)
}

/// Migration 0015: rows that existed before the ledger (seeds, the legacy
/// backfill) get one entry each on this device's stream, so another device
/// can receive them. Runs once.
pub fn backfill_existing_rows(tx: &Transaction) -> Result<(), MigrateError> {
    let refuse = |e: AppError| MigrateError::Refused { version: 15, reason: e.to_string() };
    let device_id = local::device_id(tx).map_err(refuse)?;
    let mut seq = next_seq(tx, &device_id).map_err(refuse)?;
    for table in SYNCED_TABLES {
        let exists: bool = tx.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1", [table],
                                        |r| r.get::<_, i64>(0))? > 0;
        if !exists { continue; }
        let rows = read_all_as_json(tx, table)?;
        for row in rows {
            let id = row.get("id").and_then(Value::as_str).unwrap_or("").to_string();
            if id.is_empty() { continue; }
            let updated_at = row.get("updated_at").and_then(Value::as_str).unwrap_or("").to_string();
            tx.execute(
                "INSERT INTO ledger (device_id, seq, op, entity_type, entity_id, payload, created_at)
                 VALUES (?1, ?2, 'upsert', ?3, ?4, ?5, ?6)",
                params![device_id, seq, table, id, row.to_string(), now()])?;
            tx.execute(
                "INSERT OR REPLACE INTO entity_versions (entity_type, entity_id, updated_at, device_id) VALUES (?1, ?2, ?3, ?4)",
                params![table, id, updated_at, device_id])?;
            seq += 1;
        }
    }
    Ok(())
}

/// `SELECT *` as JSON objects, column names from the statement. Blobs are
/// not on synced tables (documents carry metadata only).
pub fn read_all_as_json(con: &Connection, table: &str) -> Result<Vec<Value>, rusqlite::Error> {
    let mut st = con.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
    let names: Vec<String> = st.column_names().iter().map(|s| s.to_string()).collect();
    let rows = st.query_map([], |r| {
        let mut obj = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let v: rusqlite::types::Value = r.get(i)?;
            obj.insert(name.clone(), match v {
                rusqlite::types::Value::Null => Value::Null,
                rusqlite::types::Value::Integer(n) => Value::from(n),
                rusqlite::types::Value::Real(f) => Value::from(f),
                rusqlite::types::Value::Text(t) => Value::from(t),
                rusqlite::types::Value::Blob(_) => Value::Null,
            });
        }
        Ok(Value::Object(obj))
    })?;
    rows.collect()
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

    fn count(con: &Connection, sql: &str) -> i64 { con.query_row(sql, [], |r| r.get(0)).unwrap() }

    /// Every write appends in the same transaction; the payload is the row.
    #[test]
    fn local_writes_append_to_the_ledger() {
        let con = fresh("dev_a");
        let before = count(&con, "SELECT count(*) FROM ledger WHERE device_id = 'dev_a'");
        clients::create_minimal(&con, "ABCDE1234F", Some("Example")).unwrap();
        let after = count(&con, "SELECT count(*) FROM ledger WHERE device_id = 'dev_a'");
        assert_eq!(after, before + 1);
        let e = entries_after(&con, "dev_a", before).unwrap().remove(0);
        assert_eq!(e.entity_type, "clients");
        assert_eq!(e.payload["pan"], "ABCDE1234F");
    }

    /// docs/12: apply the same changeset twice — no duplicate rows, no changed state.
    #[test]
    fn applying_twice_is_a_noop() {
        let a = fresh("dev_a");
        let mut b = fresh("dev_b");
        clients::create_minimal(&a, "ABCDE1234F", Some("Example")).unwrap();
        let changes = entries_after(&a, "dev_a", 0).unwrap();
        let r1 = apply(&mut b, &changes).unwrap();
        let r2 = apply(&mut b, &changes).unwrap();
        assert!(r1.applied >= 1);
        assert_eq!(r2.applied, 0);
        assert_eq!(count(&b, "SELECT count(*) FROM clients WHERE pan = 'ABCDE1234F'"), 1);
        assert_eq!(cursor_map(&b).unwrap()["dev_a"], changes.last().unwrap().seq);
    }

    /// docs/12: interrupt an apply halfway and resume — final state matches.
    #[test]
    fn interrupted_apply_resumes_to_the_same_state() {
        let a = fresh("dev_a");
        for i in 0..6 {
            clients::create_minimal(&a, &format!("ABCDE12{i:02}F"), Some("Example")).unwrap();
        }
        let changes = entries_after(&a, "dev_a", 0).unwrap();
        let mut whole = fresh("dev_b");
        apply(&mut whole, &changes).unwrap();
        let mut halves = fresh("dev_c");
        let mid = changes.len() / 2;
        apply(&mut halves, &changes[..mid]).unwrap();
        apply(&mut halves, &changes).unwrap();          // resumes; the first half is a no-op
        let whole_rows = read_all_as_json(&whole, "clients").unwrap();
        let halves_rows = read_all_as_json(&halves, "clients").unwrap();
        assert_eq!(whole_rows, halves_rows);
    }

    /// docs/12: two devices write to the same row; both converge on the same winner.
    #[test]
    fn two_writers_converge() {
        let a = fresh("dev_a");
        let b = fresh("dev_b");
        let c = clients::create_minimal(&a, "ABCDE1234F", Some("Example")).unwrap();
        // seed b with the same client, then both edit it
        let seed = entries_after(&a, "dev_a", 0).unwrap();
        let mut b = b;
        apply(&mut b, &seed).unwrap();
        let mut ca = clients::get(&a, &c.id).unwrap().unwrap();
        ca.name = "Edited on A".into(); ca.updated_at = "2026-09-12T10:00:00.000Z".into();
        clients::save(&a, &ca).unwrap();
        let mut cb = clients::get(&b, &c.id).unwrap().unwrap();
        cb.name = "Edited on B".into(); cb.updated_at = "2026-09-12T11:00:00.000Z".into();   // later
        clients::save(&b, &cb).unwrap();
        let from_a = entries_after(&a, "dev_a", 0).unwrap();
        let from_b = entries_after(&b, "dev_b", 0).unwrap();
        let mut a = a;
        apply(&mut a, &from_b).unwrap();
        apply(&mut b, &from_a).unwrap();
        assert_eq!(clients::get(&a, &c.id).unwrap().unwrap().name, "Edited on B");
        assert_eq!(clients::get(&b, &c.id).unwrap().unwrap().name, "Edited on B");
    }
}
