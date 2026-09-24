//! Client import from CSV (task 3.5): dry run first, then the same rows are
//! written in one transaction. Every row is either accepted whole or listed
//! with the reason it was not.
//!
//! Columns, by header name (case-insensitive, order free): name, pan, gstin,
//! client_code, entity_type, client_group, phone_cc, phone, email,
//! portal_login_ref, source, client_file_no, tags. Only `name` plus one of
//! `pan` / `gstin` is required.

use crate::error::{AppError, AppResult};
use crate::gstin;
use crate::ids::{new_id, now};
use crate::repo::model::Client;
use crate::repo::{clients, rows};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize)]
pub struct ImportRow {
    pub line: usize,
    pub client: Client,
    pub pan_masked: String,
    pub derived_from_gstin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RowError {
    pub line: usize,
    pub name: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportPreview {
    pub ok: Vec<ImportRow>,
    pub errors: Vec<RowError>,
    pub written: usize,
}

const ENTITY_TYPES: &[&str] = &["individual", "company", "firm", "huf", "trust", "aop", "other"];

fn cell(rec: &csv::StringRecord, idx: Option<&usize>) -> Option<String> {
    idx.and_then(|i| rec.get(*i)).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn preview(con: &Connection, path: &str) -> AppResult<ImportPreview> {
    let mut reader = csv::ReaderBuilder::new().flexible(true).trim(csv::Trim::All)
        .from_path(path)
        .map_err(|e| AppError::invalid(format!("could not read the CSV: {e}")))?;
    let headers: HashMap<String, usize> = reader.headers()
        .map_err(|e| AppError::invalid(format!("no header row: {e}")))?
        .iter().enumerate().map(|(i, h)| (h.trim().to_lowercase().replace(' ', "_"), i)).collect();
    let col = |name: &str| headers.get(name);
    if col("name").is_none() {
        return Err(AppError::invalid("the CSV needs a 'name' column"));
    }
    if col("pan").is_none() && col("gstin").is_none() {
        return Err(AppError::invalid("the CSV needs a 'pan' or a 'gstin' column"));
    }

    let mut ok = Vec::new();
    let mut errors = Vec::new();
    let mut seen_pans: HashSet<String> = HashSet::new();
    let mut seen_codes: HashSet<String> = HashSet::new();

    for (i, rec) in reader.records().enumerate() {
        let line = i + 2; // 1-based, after the header
        let rec = match rec {
            Ok(r) => r,
            Err(e) => { errors.push(RowError { line, name: None, reason: format!("unreadable row: {e}") }); continue; }
        };
        let name = cell(&rec, col("name"));
        let Some(name) = name else {
            errors.push(RowError { line, name: None, reason: "name is empty".into() });
            continue;
        };
        let mut derived = false;
        let gstin_raw = cell(&rec, col("gstin")).map(|g| g.to_ascii_uppercase());
        let pan_raw = cell(&rec, col("pan")).map(|p| p.to_ascii_uppercase());
        let pan = match (pan_raw, &gstin_raw) {
            (Some(p), _) => p,
            (None, Some(g)) => match gstin::derive(g) {
                Ok(d) => { derived = true; d.pan }
                Err(e) => { errors.push(RowError { line, name: Some(name), reason: format!("gstin: {e}") }); continue; }
            },
            (None, None) => { errors.push(RowError { line, name: Some(name), reason: "no PAN and no GSTIN".into() }); continue; }
        };
        if !gstin::is_pan_shaped(&pan) {
            errors.push(RowError { line, name: Some(name), reason: "PAN is not 5 letters, 4 digits, 1 letter".into() });
            continue;
        }
        if let Some(g) = &gstin_raw {
            if let Ok(d) = gstin::derive(g) {
                if d.pan != pan {
                    errors.push(RowError { line, name: Some(name), reason: "PAN does not match the GSTIN".into() });
                    continue;
                }
            }
        }
        if !seen_pans.insert(pan.clone()) {
            errors.push(RowError { line, name: Some(name), reason: "PAN appears earlier in this file".into() });
            continue;
        }
        if clients::find_by_pan(con, &pan)?.is_some() {
            errors.push(RowError { line, name: Some(name), reason: "a client with this PAN already exists".into() });
            continue;
        }
        let client_code = cell(&rec, col("client_code"));
        if let Some(code) = &client_code {
            if !seen_codes.insert(code.clone()) {
                errors.push(RowError { line, name: Some(name), reason: "client code appears earlier in this file".into() });
                continue;
            }
            let taken: bool = con.query_row("SELECT count(*) FROM clients WHERE client_code = ?1", [code], |r| r.get::<_, i64>(0))? > 0;
            if taken {
                errors.push(RowError { line, name: Some(name), reason: "client code is already in use".into() });
                continue;
            }
        }
        let entity_type = match cell(&rec, col("entity_type")).map(|s| s.to_lowercase()) {
            Some(t) if ENTITY_TYPES.contains(&t.as_str()) => t,
            Some(t) => { errors.push(RowError { line, name: Some(name), reason: format!("entity_type '{t}' is not one of {}", ENTITY_TYPES.join(", ")) }); continue; }
            None => clients::entity_type_from_pan(&pan).to_string(),
        };
        let source = match cell(&rec, col("source")).map(|s| s.to_lowercase()) {
            Some(s) if s == "portal" || s == "eri" => s,
            Some(s) => { errors.push(RowError { line, name: Some(name), reason: format!("source '{s}' must be portal or eri") }); continue; }
            None => "portal".into(),
        };
        let ts = now();
        let client = Client {
            sync_enabled: None, note: None,
            id: new_id(),
            client_code,
            name: name.clone(),
            pan: pan.clone(),
            gstin: gstin_raw,
            entity_type,
            client_group: cell(&rec, col("client_group")),
            phone_cc: cell(&rec, col("phone_cc")).unwrap_or_else(|| "+91".into()),
            phone: cell(&rec, col("phone")),
            email: cell(&rec, col("email")),
            portal_login_ref: cell(&rec, col("portal_login_ref")).map(|s| s.to_ascii_uppercase()),
            source,
            client_file_no: cell(&rec, col("client_file_no")),
            tags: cell(&rec, col("tags")),
            created_at: ts.clone(), updated_at: ts,
        };
        ok.push(ImportRow { line, pan_masked: crate::mask::pan(&pan), client, derived_from_gstin: derived });
    }
    Ok(ImportPreview { ok, errors, written: 0 })
}

/// Write the rows a preview accepted. The preview is recomputed so a file
/// edited between the two calls cannot slip past the checks.
pub fn commit(con: &mut Connection, path: &str) -> AppResult<ImportPreview> {
    let mut preview = preview(con, path)?;
    let tx = con.transaction()?;
    for row in &preview.ok {
        rows::upsert(&tx, "clients", &row.client)?;
    }
    tx.commit()?;
    preview.written = preview.ok.len();
    Ok(preview)
}
