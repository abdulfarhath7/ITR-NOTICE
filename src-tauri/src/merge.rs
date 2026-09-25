//! Merging rows from elsewhere — a bundle, a snapshot, or a foreign ledger
//! entry — into this archive. Merge, never overwrite (docs/03):
//!
//!   - clients match on PAN; year contexts on (client, AY); proceedings on
//!     their natural key; communications on reference id; demands on their
//!     natural key; returns and forms on acknowledgement number; documents
//!     on (parent, kind) and dedupe by hash; drafts on communication;
//!     registry entries on (registry, code);
//!   - when two ids name the same thing, the lexicographically smaller id is
//!     canonical on every device, so all of them converge without talking;
//!   - a row is written only when it wins last-write-wins on updated_at
//!     (device id as tiebreaker); nothing is deleted for being absent.

use crate::error::{AppError, AppResult};
use crate::ids::now;
use crate::ledger;
use crate::repo::rows::{self, Origin};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::HashMap;

/// (table, foreign id) → local id, for the foreign keys of later rows.
pub type IdMap = HashMap<(String, String), String>;

/// The order tables are merged in: parents before children.
pub const ORDER: &[&str] = &[
    "type_registry", "clients", "year_contexts", "proceedings", "communications", "responses",
    "adjournment_requests", "demands", "demand_responses", "payments", "returns", "filed_forms",
    "documents", "drafts", "work_item_meta", "proceeding_events",
    "statutory_deadlines", "statutory_fetches", "statutory_events", "firm_dates",
];

/// Foreign-key columns per table and the table they point at.
fn fks(table: &str) -> &'static [(&'static str, &'static str)] {
    match table {
        "year_contexts" => &[("client_id", "clients")],
        "proceedings" => &[("year_context_id", "year_contexts"), ("proceeding_type_id", "type_registry")],
        "communications" => &[("proceeding_id", "proceedings"), ("communication_type_id", "type_registry")],
        "responses" => &[("proceeding_id", "proceedings"), ("in_reply_to", "communications")],
        "adjournment_requests" => &[("proceeding_id", "proceedings")],
        "demands" => &[("year_context_id", "year_contexts"), ("proceeding_id", "proceedings")],
        "demand_responses" => &[("demand_id", "demands"), ("reason_code_id", "type_registry")],
        "payments" => &[("year_context_id", "year_contexts"), ("demand_response_id", "demand_responses"), ("proceeding_id", "proceedings")],
        "returns" => &[("year_context_id", "year_contexts"), ("supersedes_id", "returns")],
        "filed_forms" => &[("year_context_id", "year_contexts"), ("form_type_id", "type_registry")],
        "drafts" => &[("communication_id", "communications")],
        "proceeding_events" => &[("proceeding_id", "proceedings"), ("communication_id", "communications")],
        _ => &[],
    }
}

fn str_of(row: &Value, key: &str) -> Option<String> {
    row.get(key).and_then(Value::as_str).map(str::to_string)
}

/// The local row that means the same thing as `row`, if any.
pub fn natural_match(con: &Connection, table: &str, row: &Value) -> AppResult<Option<String>> {
    let q = |sql: &str, binds: Vec<Option<String>>| -> AppResult<Option<String>> {
        Ok(con.query_row(sql, rusqlite::params_from_iter(binds), |r| r.get::<_, String>(0)).optional()?)
    };
    Ok(match table {
        "type_registry" => q("SELECT id FROM type_registry WHERE registry_name = ?1 AND code = ?2",
                             vec![str_of(row, "registry_name"), str_of(row, "code")])?,
        "clients" => q("SELECT id FROM clients WHERE pan = ?1", vec![str_of(row, "pan")])?,
        "year_contexts" => q("SELECT id FROM year_contexts WHERE client_id = ?1 AND assessment_year IS ?2",
                             vec![str_of(row, "client_id"), str_of(row, "assessment_year")])?,
        "proceedings" => q("SELECT id FROM proceedings WHERE natural_key = ?1", vec![str_of(row, "natural_key")])?,
        "communications" => q("SELECT id FROM communications WHERE reference_id = ?1", vec![str_of(row, "reference_id")])?,
        "demands" => q("SELECT id FROM demands WHERE natural_key = ?1", vec![str_of(row, "natural_key")])?,
        "returns" => q("SELECT id FROM returns WHERE acknowledgement_number = ?1", vec![str_of(row, "acknowledgement_number")])?,
        "filed_forms" => q("SELECT id FROM filed_forms WHERE acknowledgement_number = ?1", vec![str_of(row, "acknowledgement_number")])?,
        "documents" => q("SELECT id FROM documents WHERE parent_type = ?1 AND parent_id = ?2 AND doc_kind = ?3",
                         vec![str_of(row, "parent_type"), str_of(row, "parent_id"), str_of(row, "doc_kind")])?,
        "drafts" => q("SELECT id FROM drafts WHERE communication_id = ?1", vec![str_of(row, "communication_id")])?,
        // Immutable and written once per change; the same sighting from two
        // devices is one event.
        // Content-addressed ids (docs/19 §2.2): the same row on two devices
        // already shares an id. Events match on what and when.
        "statutory_events" => q("SELECT id FROM statutory_events WHERE deadline_id = ?1 AND kind = ?2 AND at = ?3",
                                vec![str_of(row, "deadline_id"), str_of(row, "kind"), str_of(row, "at")])?,
        "proceeding_events" => q("SELECT id FROM proceeding_events WHERE proceeding_id = ?1 AND kind = ?2 AND at = ?3",
                                 vec![str_of(row, "proceeding_id"), str_of(row, "kind"), str_of(row, "at")])?,
        "payments" => match str_of(row, "cin") {
            Some(cin) => q("SELECT id FROM payments WHERE cin = ?1", vec![Some(cin)])?,
            None => None,
        },
        _ => None,
    })
}

/// Tables that reference `table` through which column.
fn children(table: &str) -> Vec<(&'static str, &'static str)> {
    let mut out = Vec::new();
    for t in ORDER {
        for (col, target) in fks(t) {
            if *target == table { out.push((*t, *col)); }
        }
    }
    if table != "documents" {
        // documents point at any parent through parent_id
        out.push(("documents", "parent_id"));
    }
    out
}

/// Give a local row the canonical (smaller) id, moving every reference with
/// it. Recorded as local writes so the rename propagates.
fn remap_local(con: &Connection, table: &str, old: &str, new: &str) -> AppResult<()> {
    con.execute(&format!("UPDATE {table} SET id = ?1, updated_at = ?2 WHERE id = ?3"), params![new, now(), old])?;
    for (child, col) in children(table) {
        if child == "documents" {
            let ptype = parent_type_for(table);
            con.execute("UPDATE documents SET parent_id = ?1 WHERE parent_type = ?2 AND parent_id = ?3",
                        params![new, ptype, old])?;
        } else {
            con.execute(&format!("UPDATE {child} SET {col} = ?1 WHERE {col} = ?2"), params![new, old])?;
        }
    }
    con.execute("UPDATE entity_versions SET entity_id = ?1 WHERE entity_type = ?2 AND entity_id = ?3",
                params![new, table, old])?;
    // The row under its new id, and its children, get ledger entries.
    if let Some(row) = ledger::read_all_as_json(con, table)?.into_iter().find(|r| r.get("id").and_then(Value::as_str) == Some(new)) {
        let updated_at = str_of(&row, "updated_at").unwrap_or_default();
        ledger::after_write(con, table, new, "upsert", &row, &updated_at, Origin::Local)?;
    }
    for (child, col) in children(table) {
        let rows_json = ledger::read_all_as_json(con, child)?;
        for r in rows_json {
            let points = if child == "documents" { str_of(&r, "parent_id").as_deref() == Some(new) }
                         else { str_of(&r, col).as_deref() == Some(new) };
            if points {
                let id = str_of(&r, "id").unwrap_or_default();
                let updated_at = str_of(&r, "updated_at").unwrap_or_default();
                ledger::after_write(con, child, &id, "upsert", &r, &updated_at, Origin::Local)?;
            }
        }
    }
    Ok(())
}

pub fn parent_type_for(table: &str) -> &'static str {
    match table {
        "proceedings" => "proceeding", "communications" => "communication", "responses" => "response",
        "adjournment_requests" => "adjournment_request", "demands" => "demand", "demand_responses" => "demand_response",
        "payments" => "payment", "returns" => "return", "filed_forms" => "filed_form", _ => "",
    }
}

fn table_for_parent_type(pt: &str) -> Option<&'static str> {
    ORDER.iter().copied().find(|t| parent_type_for(t) == pt)
}

/// Rewrite the row's foreign keys through the id map and settle its own id
/// against the local archive. Returns the local id to write under.
pub fn resolve(con: &Connection, table: &str, row: &mut Value, idmap: &mut IdMap) -> AppResult<String> {
    let incoming_id = str_of(row, "id").ok_or_else(|| AppError::invalid("row has no id"))?;
    // foreign keys first, so natural matching sees local parents
    for (col, target) in fks(table) {
        if let Some(v) = str_of(row, col) {
            if let Some(local) = idmap.get(&(target.to_string(), v.clone())) {
                row[*col] = Value::from(local.clone());
            }
        }
    }
    if table == "documents" {
        if let (Some(pt), Some(pid)) = (str_of(row, "parent_type"), str_of(row, "parent_id")) {
            if let Some(t) = table_for_parent_type(&pt) {
                if let Some(local) = idmap.get(&(t.to_string(), pid)) {
                    row["parent_id"] = Value::from(local.clone());
                }
            }
        }
    }
    let local_id = match natural_match(con, table, row)? {
        Some(existing) if existing == incoming_id => existing,
        Some(existing) => {
            // The same thing under two ids: the smaller is canonical everywhere.
            if incoming_id < existing {
                remap_local(con, table, &existing, &incoming_id)?;
                incoming_id.clone()
            } else {
                existing
            }
        }
        None => incoming_id.clone(),
    };
    if local_id != incoming_id {
        row["id"] = Value::from(local_id.clone());
    }
    idmap.insert((table.to_string(), incoming_id), local_id.clone());
    Ok(local_id)
}

/// Write one foreign row if it wins. `version` is the (updated_at,
/// device_id) the row carries where it came from.
pub fn merge_row(con: &Connection, table: &str, mut row: Value, version: (&str, &str), idmap: &mut IdMap) -> AppResult<bool> {
    let local_id = resolve(con, table, &mut row, idmap)?;
    if !ledger::incoming_wins(con, table, &local_id, version.0, version.1)? {
        return Ok(false);
    }
    rows::write_value(con, table, &row, Origin::Replay { device_id: version.1 })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{clients, local};

    fn fresh(device: &str) -> Connection {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        local::set(&con, local::DEVICE_ID, device).unwrap();
        con
    }

    /// Two devices add the same client by hand; after exchanging streams
    /// both hold one row under the same (smaller) id.
    #[test]
    fn same_pan_from_two_devices_converges_on_one_id() {
        let a = fresh("dev_a");
        let b = fresh("dev_b");
        let ca = clients::create_minimal(&a, "ABCDE1234F", Some("On A")).unwrap();
        let cb = clients::create_minimal(&b, "ABCDE1234F", Some("On B")).unwrap();
        let from_a = ledger::entries_after(&a, "dev_a", 0).unwrap();
        let from_b = ledger::entries_after(&b, "dev_b", 0).unwrap();
        let mut a = a;
        let mut b = b;
        ledger::apply(&mut a, &from_b).unwrap();
        ledger::apply(&mut b, &from_a).unwrap();
        let canonical = std::cmp::min(ca.id.clone(), cb.id.clone());
        for con in [&a, &b] {
            let n: i64 = con.query_row("SELECT count(*) FROM clients WHERE pan = 'ABCDE1234F'", [], |r| r.get(0)).unwrap();
            assert_eq!(n, 1);
            let id: String = con.query_row("SELECT id FROM clients WHERE pan = 'ABCDE1234F'", [], |r| r.get(0)).unwrap();
            assert_eq!(id, canonical);
        }
    }
}
