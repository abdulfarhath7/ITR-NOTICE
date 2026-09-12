//! Documents and their content-addressed blobs. Document first, row second:
//! `store_blob` runs before the `documents` row that points at it.

use crate::error::AppResult;
use crate::ids::{new_id, now, sha256_hex};
use crate::repo::model::Document;
use crate::repo::rows;
use rusqlite::{params, Connection, OptionalExtension, Row};

pub fn from_row(r: &Row) -> rusqlite::Result<Document> {
    Ok(Document {
        id: r.get("id")?, parent_type: r.get("parent_type")?, parent_id: r.get("parent_id")?,
        doc_kind: r.get("doc_kind")?, filename: r.get("filename")?, file_hash: r.get("file_hash")?,
        source_url: r.get("source_url")?, fetched_at: r.get("fetched_at")?,
        page_count: r.get("page_count")?, byte_size: r.get("byte_size")?, state: r.get("state")?,
        storage_path: r.get("storage_path")?, verified_flag: r.get("verified_flag")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

/// Write the bytes under their hash. A second copy of the same bytes is a
/// no-op — dedupe by hash (docs/03).
pub fn store_blob(con: &Connection, bytes: &[u8]) -> AppResult<String> {
    let hash = sha256_hex(bytes);
    con.execute(
        "INSERT OR IGNORE INTO document_blobs (file_hash, byte_size, bytes, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![hash, bytes.len() as i64, bytes, now()],
    )?;
    Ok(hash)
}

pub fn blob_exists(con: &Connection, hash: &str) -> AppResult<bool> {
    Ok(con.query_row("SELECT 1 FROM document_blobs WHERE file_hash = ?1", [hash], |_| Ok(()))
        .optional()?.is_some())
}

pub fn read_blob(con: &Connection, hash: &str) -> AppResult<Option<Vec<u8>>> {
    Ok(con.query_row("SELECT bytes FROM document_blobs WHERE file_hash = ?1", [hash], |r| r.get(0))
        .optional()?)
}

pub fn get(con: &Connection, id: &str) -> AppResult<Option<Document>> {
    Ok(con.query_row("SELECT * FROM documents WHERE id = ?1", [id], from_row).optional()?)
}

pub fn for_parent(con: &Connection, parent_type: &str, parent_id: &str) -> AppResult<Vec<Document>> {
    let mut st = con.prepare(
        "SELECT * FROM documents WHERE parent_type = ?1 AND parent_id = ?2 ORDER BY created_at")?;
    let rows = st.query_map(params![parent_type, parent_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn find(con: &Connection, parent_type: &str, parent_id: &str, doc_kind: &str) -> AppResult<Option<Document>> {
    Ok(con.query_row(
        "SELECT * FROM documents WHERE parent_type = ?1 AND parent_id = ?2 AND doc_kind = ?3
         ORDER BY created_at LIMIT 1",
        params![parent_type, parent_id, doc_kind], from_row).optional()?)
}

/// Attach stored bytes to a parent. Idempotent for the same bytes; a
/// different PDF for the same slot replaces the pointer (the old blob stays
/// content-addressed and unreferenced — never deleted here).
pub fn attach_stored(con: &Connection, parent_type: &str, parent_id: &str, doc_kind: &str,
                     filename: Option<&str>, bytes: &[u8], source_url: Option<&str>,
                     fetched_at: Option<&str>) -> AppResult<Document> {
    let hash = store_blob(con, bytes)?;
    let ts = now();
    let existing = find(con, parent_type, parent_id, doc_kind)?;
    let doc = match existing {
        Some(d) if d.file_hash.as_deref() == Some(&hash) => return Ok(d),
        Some(d) => Document {
            file_hash: Some(hash.clone()), byte_size: Some(bytes.len() as i64),
            storage_path: Some(format!("blob:{hash}")), state: "stored".into(),
            fetched_at: fetched_at.map(str::to_string).or(d.fetched_at),
            filename: filename.map(str::to_string).or(d.filename),
            source_url: source_url.map(str::to_string).or(d.source_url),
            updated_at: ts, ..d
        },
        None => Document {
            id: new_id(), parent_type: parent_type.into(), parent_id: parent_id.into(),
            doc_kind: doc_kind.into(), filename: filename.map(str::to_string),
            file_hash: Some(hash.clone()), source_url: source_url.map(str::to_string),
            fetched_at: fetched_at.map(str::to_string).or_else(|| Some(now())),
            page_count: None, byte_size: Some(bytes.len() as i64), state: "stored".into(),
            storage_path: Some(format!("blob:{hash}")), verified_flag: 0,
            created_at: ts.clone(), updated_at: ts,
        },
    };
    rows::upsert(con, "documents", &doc)?;
    Ok(doc)
}

/// The pair rule: a node that must exist even though nothing has been
/// fetched yet (an awaited receipt). Creates it once.
pub fn ensure_pending(con: &Connection, parent_type: &str, parent_id: &str, doc_kind: &str) -> AppResult<Document> {
    if let Some(d) = find(con, parent_type, parent_id, doc_kind)? {
        return Ok(d);
    }
    let ts = now();
    let doc = Document {
        id: new_id(), parent_type: parent_type.into(), parent_id: parent_id.into(),
        doc_kind: doc_kind.into(), filename: None, file_hash: None, source_url: None,
        fetched_at: None, page_count: None, byte_size: None, state: "pending".into(),
        storage_path: None, verified_flag: 0, created_at: ts.clone(), updated_at: ts,
    };
    rows::upsert(con, "documents", &doc)?;
    Ok(doc)
}
