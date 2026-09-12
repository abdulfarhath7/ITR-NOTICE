//! type_registry lookups. Adding a type is an INSERT (docs/02); this module
//! only reads.

use crate::error::{AppError, AppResult};
use crate::repo::model::TypeEntry;
use rusqlite::{params, Connection, OptionalExtension, Row};

fn entry(r: &Row) -> rusqlite::Result<TypeEntry> {
    Ok(TypeEntry {
        id: r.get("id")?, registry_name: r.get("registry_name")?, code: r.get("code")?,
        label: r.get("label")?, category: r.get("category")?, statute: r.get("statute")?,
        field_template: r.get("field_template")?, status_set: r.get("status_set")?,
        sort_order: r.get("sort_order")?, active: r.get("active")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn list(con: &Connection, registry_name: &str) -> AppResult<Vec<TypeEntry>> {
    let mut st = con.prepare(
        "SELECT * FROM type_registry WHERE registry_name = ?1 AND active = 1 ORDER BY sort_order, label")?;
    let rows = st.query_map([registry_name], entry)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(con: &Connection, id: &str) -> AppResult<Option<TypeEntry>> {
    Ok(con.query_row("SELECT * FROM type_registry WHERE id = ?1", [id], entry).optional()?)
}

pub fn id_for(con: &Connection, registry_name: &str, code: &str) -> AppResult<Option<String>> {
    Ok(con.query_row(
        "SELECT id FROM type_registry WHERE registry_name = ?1 AND code = ?2",
        params![registry_name, code], |r| r.get(0)).optional()?)
}

/// The id for a code that must exist (seeded). A missing seed is a build
/// error, reported as such rather than silently mapped to something else.
pub fn require(con: &Connection, registry_name: &str, code: &str) -> AppResult<String> {
    id_for(con, registry_name, code)?
        .ok_or_else(|| AppError::state(format!("type_registry has no {registry_name} '{code}'")))
}
