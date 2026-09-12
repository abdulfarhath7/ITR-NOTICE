//! Documents leave the archive only through these two commands, and both
//! are available for every status (docs/08).

use crate::commands::lock_db;
use crate::error::{AppError, AppResult};
use crate::repo::documents;
use crate::AppState;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

fn bytes_for(state: &AppState, document_id: &str) -> AppResult<(Vec<u8>, String)> {
    let con = lock_db(state)?;
    let doc = documents::get(&con, document_id)?.ok_or_else(|| AppError::not_found("document"))?;
    let hash = doc.file_hash.ok_or_else(|| AppError::state("this document has not been fetched yet"))?;
    let bytes = documents::read_blob(&con, &hash)?.ok_or_else(|| AppError::state("document bytes are missing"))?;
    Ok((bytes, doc.filename.unwrap_or_else(|| format!("{document_id}.pdf"))))
}

/// Written to a per-app temp folder and handed to the OS viewer. The temp
/// copy is unencrypted for as long as the OS keeps it; the folder is
/// cleared on the next launch.
#[tauri::command]
pub fn open_document(app: tauri::AppHandle, state: State<AppState>, document_id: String) -> AppResult<()> {
    let (bytes, filename) = bytes_for(&state, &document_id)?;
    let dir = state.temp_dir.clone();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(safe_filename(&filename));
    std::fs::write(&path, bytes)?;
    app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| AppError::Io { message: format!("could not open the viewer: {e}") })
}

#[tauri::command]
pub fn save_document_as(state: State<AppState>, document_id: String, path: String) -> AppResult<()> {
    let (bytes, _) = bytes_for(&state, &document_id)?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

/// Base64 for an in-app preview (an <iframe> over a blob URL).
#[tauri::command]
pub fn get_document_base64(state: State<AppState>, document_id: String) -> AppResult<String> {
    use base64::Engine;
    let (bytes, _) = bytes_for(&state, &document_id)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub fn safe_filename(name: &str) -> String {
    let cleaned: String = name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if cleaned.is_empty() { "document.pdf".into() } else { cleaned }
}

/// Clear the temp folder from the previous session.
pub fn clear_temp(dir: &std::path::Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for e in entries.flatten() {
            let _ = std::fs::remove_file(e.path());
        }
    }
}
