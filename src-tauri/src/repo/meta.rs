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

