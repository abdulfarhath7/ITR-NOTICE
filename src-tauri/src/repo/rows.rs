//! The one write path for synced tables. A row is written as a whole — the
//! same JSON that becomes the ledger payload — so an upsert here and a
//! ledger replay on another device are literally the same operation.

use crate::error::{AppError, AppResult};
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;
use serde_json::Value;

/// Tables whose writes are synced through the ledger (docs/03).
pub const SYNCED_TABLES: &[&str] = &[
    "clients", "year_contexts", "proceedings", "communications", "responses",
    "adjournment_requests", "demands", "demand_responses", "payments", "returns",
    "filed_forms", "documents", "type_registry", "drafts", "work_item_meta",
];

/// Local tables written through the same function for uniformity, never
/// ledgered.
pub const LOCAL_TABLES: &[&str] = &["ingestion_runs", "document_blobs", "local_kv", "ingestion_sweeps", "ingestion_jobs",
                                      "session_locks", "ledger", "ledger_received", "sync_cursors", "entity_versions"];

/// How a write arrived. A local write appends to this device's ledger
/// stream; a replay of another device's entry does not (it already is one).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Origin<'a> {
    Local,
    Replay { device_id: &'a str },
}

thread_local! {
    /// Set by the ingestion runner around its writes (which happen under
    /// the archive lock, without an await, so the thread is stable). A
    /// local write made while it is set is a sweep write (migration 0016).
    pub static SWEEP_CONTEXT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub fn in_sweep_context() -> bool {
    SWEEP_CONTEXT.with(|c| c.get())
}

/// Run `f` with every local write marked as a sweep write.
pub fn with_sweep_context<T>(f: impl FnOnce() -> T) -> T {
    SWEEP_CONTEXT.with(|c| c.set(true));
    let out = f();
    SWEEP_CONTEXT.with(|c| c.set(false));
    out
}

fn check_table(table: &str) -> AppResult<()> {
    if SYNCED_TABLES.contains(&table) || LOCAL_TABLES.contains(&table) {
        Ok(())
    } else {
        Err(AppError::invalid(format!("unknown table {table}")))
    }
}

fn to_sql(v: &Value) -> AppResult<SqlValue> {
    Ok(match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() { SqlValue::Integer(i) }
            else if let Some(f) = n.as_f64() { SqlValue::Real(f) }
            else { return Err(AppError::invalid("number out of range")); }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(v.to_string()),
    })
}

/// Insert the row, or replace every column except `id` and `created_at` if
/// a row with this `id` exists. A synced table's write appends the ledger
/// entry in the same transaction (docs/03) — this is the one write path.
pub fn upsert<T: Serialize>(con: &Connection, table: &str, row: &T) -> AppResult<()> {
    upsert_with(con, table, row, Origin::Local)
}

pub fn upsert_with<T: Serialize>(con: &Connection, table: &str, row: &T, origin: Origin) -> AppResult<()> {
    check_table(table)?;
    let value = serde_json::to_value(row)?;
    write_value(con, table, &value, origin)
}

/// The same write from an already-serialised row (a ledger payload).
pub fn write_value(con: &Connection, table: &str, value: &Value, origin: Origin) -> AppResult<()> {
    check_table(table)?;
    let obj = value.as_object().ok_or_else(|| AppError::invalid("row is not an object"))?;
    if !obj.contains_key("id") {
        return Err(AppError::invalid(format!("{table} row has no id")));
    }
    let cols: Vec<&String> = obj.keys().collect();
    let placeholders: Vec<String> = (1..=cols.len()).map(|i| format!("?{i}")).collect();
    let updates: Vec<String> = cols.iter()
        .filter(|c| c.as_str() != "id" && c.as_str() != "created_at")
        .map(|c| format!("{c} = excluded.{c}"))
        .collect();
    let sql = format!(
        "INSERT INTO {table} ({}) VALUES ({}) ON CONFLICT(id) DO UPDATE SET {}",
        cols.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", "),
        placeholders.join(", "),
        updates.join(", "),
    );
    let values = cols.iter().map(|c| to_sql(&obj[*c])).collect::<AppResult<Vec<_>>>()?;
    con.execute(&sql, params_from_iter(values))?;
    if SYNCED_TABLES.contains(&table) {
        let id = obj["id"].as_str().unwrap_or_default();
        let updated_at = obj.get("updated_at").and_then(Value::as_str).unwrap_or("").to_string();
        crate::ledger::after_write(con, table, id, "upsert", value, &updated_at, origin)?;
    }
    Ok(())
}

pub fn delete_with(con: &Connection, table: &str, id: &str, origin: Origin) -> AppResult<()> {
    check_table(table)?;
    con.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])?;
    if SYNCED_TABLES.contains(&table) {
        let payload = serde_json::json!({ "id": id });
        crate::ledger::after_write(con, table, id, "delete", &payload, &crate::ids::now(), origin)?;
    }
    Ok(())
}
