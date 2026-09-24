//! Per-item metadata a person authors (docs/16 §2.2): owner and note. The
//! row id is `module:item_id`, so two devices writing the same item's meta
//! name the same row and last-write-wins settles it like any other.

use crate::error::{AppError, AppResult};
use crate::repo::rows;
use rusqlite::{Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

pub const MODULES: &[&str] = &["proceedings", "demands", "returns", "forms"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemMeta {
    pub id: String,
    pub module: String,
    pub item_id: String,
    pub assignee: Option<String>,
    pub note: Option<String>,
    pub updated_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn from_row(r: &Row) -> rusqlite::Result<WorkItemMeta> {
    Ok(WorkItemMeta {
        id: r.get("id")?, module: r.get("module")?, item_id: r.get("item_id")?,
        assignee: r.get("assignee")?, note: r.get("note")?, updated_by: r.get("updated_by")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn meta_id(module: &str, item_id: &str) -> String {
    format!("{module}:{item_id}")
}

pub fn get(con: &Connection, module: &str, item_id: &str) -> AppResult<Option<WorkItemMeta>> {
    Ok(con.query_row("SELECT * FROM work_item_meta WHERE id = ?1", [meta_id(module, item_id)], from_row).optional()?)
}

/// What a caller wants changed. `None` leaves a field as it is; an empty
/// string clears it.
pub struct MetaPatch {
    pub assignee: Option<String>,
    pub note: Option<String>,
}

fn blank_to_none(s: String) -> Option<String> {
    let t = s.trim();
    if t.is_empty() { None } else { Some(s) }
}

pub fn set(con: &Connection, module: &str, item_id: &str, patch: MetaPatch, device_id: &str) -> AppResult<WorkItemMeta> {
    if !MODULES.contains(&module) {
        return Err(AppError::invalid(format!("unknown module {module}")));
    }
    if item_id.trim().is_empty() {
        return Err(AppError::invalid("item id is empty"));
    }
    let ts = crate::ids::now();
    let mut m = get(con, module, item_id)?.unwrap_or_else(|| WorkItemMeta {
        id: meta_id(module, item_id), module: module.into(), item_id: item_id.into(),
        assignee: None, note: None, updated_by: None, created_at: ts.clone(), updated_at: ts.clone(),
    });
    if let Some(a) = patch.assignee { m.assignee = blank_to_none(a.trim().to_string()); }
    if let Some(n) = patch.note { m.note = blank_to_none(n); }
    m.updated_by = Some(device_id.to_string());
    m.updated_at = ts;
    rows::upsert(con, "work_item_meta", &m)?;
    Ok(m)
}

/// Every owner name already used, for the owner select and the datalist.
pub fn assignees(con: &Connection) -> AppResult<Vec<String>> {
    let mut st = con.prepare(
        "SELECT DISTINCT assignee FROM work_item_meta WHERE assignee IS NOT NULL AND assignee <> ''
         ORDER BY assignee COLLATE NOCASE")?;
    let rows = st.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::local;

    /// Task 14.1: an assignee set here lands in the ledger and on the row.
    #[test]
    fn assignee_round_trips_through_the_ledger() {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        local::set(&con, local::DEVICE_ID, "dev_a").unwrap();
        set(&con, "proceedings", "p1", MetaPatch { assignee: Some("Rao".into()), note: None }, "dev_a").unwrap();
        let entries = crate::ledger::entries_after(&con, "dev_a", 0).unwrap();
        let e = entries.iter().find(|e| e.entity_type == "work_item_meta").expect("ledger entry");
        assert_eq!(e.entity_id, "proceedings:p1");
        assert_eq!(e.payload["assignee"], "Rao");
        // a second device receives it
        let mut b = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut b).unwrap();
        local::set(&b, local::DEVICE_ID, "dev_b").unwrap();
        crate::ledger::apply(&mut b, &entries).unwrap();
        assert_eq!(get(&b, "proceedings", "p1").unwrap().unwrap().assignee.as_deref(), Some("Rao"));
        // clearing
        set(&con, "proceedings", "p1", MetaPatch { assignee: Some(String::new()), note: Some("call AO".into()) }, "dev_a").unwrap();
        let m = get(&con, "proceedings", "p1").unwrap().unwrap();
        assert_eq!(m.assignee, None);
        assert_eq!(m.note.as_deref(), Some("call AO"));
        assert_eq!(assignees(&con).unwrap(), Vec::<String>::new());
    }
}
