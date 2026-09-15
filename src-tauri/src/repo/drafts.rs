//! AI drafts, one per communication, cached: never regenerated on their own.

use crate::error::AppResult;
use crate::repo::model::Draft;
use crate::repo::rows;
use rusqlite::{Connection, OptionalExtension, Row};

pub fn from_row(r: &Row) -> rusqlite::Result<Draft> {
    Ok(Draft {
        id: r.get("id")?, communication_id: r.get("communication_id")?,
        generated_at: r.get("generated_at")?, model: r.get("model")?, summary: r.get("summary")?,
        checklist_json: r.get("checklist_json")?, draft_text: r.get("draft_text")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

pub fn for_communication(con: &Connection, communication_id: &str) -> AppResult<Option<Draft>> {
    Ok(con.query_row("SELECT * FROM drafts WHERE communication_id = ?1", [communication_id], from_row)
        .optional()?)
}

/// The communications of a proceeding that already have a draft.
pub fn communications_with_draft(con: &Connection, proceeding_id: &str) -> AppResult<std::collections::HashSet<String>> {
    let mut st = con.prepare(
        "SELECT d.communication_id FROM drafts d JOIN communications c ON c.id = d.communication_id WHERE c.proceeding_id = ?1")?;
    let rows = st.query_map([proceeding_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn save(con: &Connection, draft: &Draft) -> AppResult<()> {
    rows::upsert(con, "drafts", draft)
}
