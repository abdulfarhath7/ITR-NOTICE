//! The `.draftax` file bundle (docs/03, docs/07): the fallback transport
//! when the relay is out of reach — email, USB.
//!
//! Layout inside: manifest.json, snapshot.json, ledger.jsonl,
//! documents/<sha256>, credentials.json (only on explicit request), and a
//! detached Ed25519 signature over the manifest. The whole container is a
//! zip encrypted with AES-256-GCM under a key derived from the passphrase
//! with Argon2id:
//!
//!   "DRAFTAX1" | salt (16) | nonce (12) | ciphertext
//!
//! Import is a merge, never an overwrite. Credentials are excluded by
//! default; including them needs a second confirmation and a strong
//! passphrase (task 6.8).

use crate::error::{AppError, AppResult};
use crate::ids::now;
use crate::ledger::{self, Entry};
use crate::repo::{clients, local};
use crate::snapshot::{self, Snapshot};
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Write};

const MAGIC: &[u8; 8] = b"DRAFTAX1";
const SIGNING_KEY: &str = "device-signing-key";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub format: u32,
    pub product: String,
    pub schema_version: u32,
    pub device_id: String,
    pub created_at: String,
    pub cursor: ledger::CursorMap,
    pub counts: BTreeMap<String, i64>,
    pub includes_documents: bool,
    pub includes_credentials: bool,
    pub signer_public_key: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ExportSummary {
    pub path: String,
    pub rows: i64,
    pub ledger_entries: i64,
    pub documents: i64,
    pub credentials: i64,
    pub bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ImportSummary {
    pub device_id: String,
    pub created_at: String,
    pub signature_ok: bool,
    pub rows_written: i64,
    pub rows_kept_local: i64,
    pub ledger_applied: i64,
    pub documents_added: i64,
    pub documents_already_held: i64,
    pub credentials_written: i64,
    pub errors: Vec<String>,
}

// ------------------------------------------------------------ device key

/// The device's Ed25519 identity, generated on first use and kept in the
/// keychain. The public half is what the relay roster will hold.
pub fn signing_key() -> AppResult<SigningKey> {
    // A machine without a keychain (a CI runner, a locked-down profile)
    // still signs — with a key that lives only for this process. The
    // relay roster (Phase 7) is where a persistent identity is required.
    let stored = crate::keychain::load_secret(SIGNING_KEY).unwrap_or(None);
    if let Some(hex_key) = stored {
        if let Ok(bytes) = hex::decode(&hex_key) {
            if bytes.len() == 32 {
                let arr: [u8; 32] = bytes.try_into().map_err(|_| AppError::state("bad signing key length"))?;
                return Ok(SigningKey::from_bytes(&arr));
            }
        }
    }
    let mut seed = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut seed);
    let key = SigningKey::from_bytes(&seed);
    let _ = crate::keychain::save_secret(SIGNING_KEY, &hex::encode(seed));
    Ok(key)
}

pub fn public_key_b64(key: &SigningKey) -> String {
    base64::engine::general_purpose::STANDARD.encode(key.verifying_key().to_bytes())
}

// ------------------------------------------------------------ passphrase

/// A strong passphrase for a bundle that carries credentials: twelve or
/// more characters with letters, digits and something else.
pub fn passphrase_strong_enough(p: &str) -> Result<(), String> {
    if p.chars().count() < 12 { return Err("use at least 12 characters".into()); }
    let letters = p.chars().any(|c| c.is_alphabetic());
    let digits = p.chars().any(|c| c.is_ascii_digit());
    let other = p.chars().any(|c| !c.is_alphanumeric());
    if !(letters && digits && other) { return Err("mix letters, digits and at least one symbol".into()); }
    Ok(())
}

fn derive_key(passphrase: &str, salt: &[u8]) -> AppResult<[u8; 32]> {
    let mut key = [0u8; 32];
    Argon2::default().hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::state(format!("key derivation failed: {e}")))?;
    Ok(key)
}

fn seal(plain: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);
    let key = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::state(e.to_string()))?;
    let ct = cipher.encrypt(Nonce::from_slice(&nonce), plain).map_err(|_| AppError::state("encryption failed"))?;
    let mut out = Vec::with_capacity(8 + 16 + 12 + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn open(sealed: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    if sealed.len() < 8 + 16 + 12 || &sealed[..8] != MAGIC {
        return Err(AppError::invalid("this is not a .draftax bundle"));
    }
    let salt = &sealed[8..24];
    let nonce = &sealed[24..36];
    let key = derive_key(passphrase, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::state(e.to_string()))?;
    cipher.decrypt(Nonce::from_slice(nonce), &sealed[36..])
        .map_err(|_| AppError::invalid("wrong passphrase, or the bundle is damaged"))
}

// ------------------------------------------------------------ export

pub struct ExportOptions {
    pub include_documents: bool,
    pub include_credentials: bool,
}

pub fn export(con: &Connection, path: &str, passphrase: &str, opts: &ExportOptions) -> AppResult<ExportSummary> {
    if passphrase.is_empty() {
        return Err(AppError::invalid("a passphrase is required"));
    }
    if opts.include_credentials {
        passphrase_strong_enough(passphrase).map_err(AppError::invalid)?;
    }
    let key = signing_key()?;
    let snap = snapshot::build(con)?;
    let tail: Vec<Entry> = Vec::new();  // the snapshot is current; the tail is empty by construction
    let mut counts: BTreeMap<String, i64> = BTreeMap::new();
    let mut rows = 0i64;
    for (t, r) in &snap.tables { counts.insert(t.clone(), r.len() as i64); rows += r.len() as i64; }

    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::<u8>::new()));
    let opt = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    // documents
    let mut documents = 0i64;
    if opts.include_documents {
        let mut st = con.prepare("SELECT file_hash, bytes FROM document_blobs")?;
        let blobs = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))?;
        for b in blobs {
            let (hash, bytes) = b?;
            zip.start_file(format!("documents/{hash}"), opt.compression_method(zip::CompressionMethod::Stored))
                .map_err(|e| AppError::Io { message: e.to_string() })?;
            zip.write_all(&bytes)?;
            documents += 1;
        }
    }

    // credentials: portal passwords for every login this book uses
    let mut credentials = 0i64;
    if opts.include_credentials {
        let mut creds: BTreeMap<String, String> = BTreeMap::new();
        for c in clients::list(con)? {
            let login = c.portal_login_ref.clone().unwrap_or(c.pan.clone());
            if creds.contains_key(&login) { continue; }
            if let Ok(Some(pw)) = crate::keychain::load_portal_password(&login) {
                creds.insert(login, pw);
            }
        }
        credentials = creds.len() as i64;
        zip.start_file("credentials.json", opt).map_err(|e| AppError::Io { message: e.to_string() })?;
        zip.write_all(serde_json::to_string(&creds)?.as_bytes())?;
    }

    let manifest = Manifest {
        format: 1, product: "draftax".into(), schema_version: crate::migrate::current_version(con)?,
        device_id: local::device_id(con)?, created_at: now(), cursor: snap.cursor.clone(), counts,
        includes_documents: opts.include_documents, includes_credentials: opts.include_credentials,
        signer_public_key: public_key_b64(&key),
    };
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    let signature = key.sign(&manifest_bytes);

    zip.start_file("manifest.json", opt).map_err(|e| AppError::Io { message: e.to_string() })?;
    zip.write_all(&manifest_bytes)?;
    zip.start_file("signature", opt).map_err(|e| AppError::Io { message: e.to_string() })?;
    zip.write_all(&signature.to_bytes())?;
    zip.start_file("snapshot.json", opt).map_err(|e| AppError::Io { message: e.to_string() })?;
    zip.write_all(&serde_json::to_vec(&snap)?)?;
    zip.start_file("ledger.jsonl", opt).map_err(|e| AppError::Io { message: e.to_string() })?;
    for e in &tail { zip.write_all(serde_json::to_string(e)?.as_bytes())?; zip.write_all(b"\n")?; }
    let cursor = zip.finish().map_err(|e| AppError::Io { message: e.to_string() })?;

    let sealed = seal(&cursor.into_inner(), passphrase)?;
    std::fs::write(path, &sealed)?;
    Ok(ExportSummary { path: path.into(), rows, ledger_entries: tail.len() as i64, documents, credentials,
                       bytes: sealed.len() as u64 })
}

// ------------------------------------------------------------ import

/// Decrypt and read the manifest only.
pub fn peek(path: &str, passphrase: &str) -> AppResult<Manifest> {
    let sealed = std::fs::read(path)?;
    let plain = open(&sealed, passphrase)?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(plain))
        .map_err(|e| AppError::invalid(format!("the bundle is not readable: {e}")))?;
    let mut f = zip.by_name("manifest.json").map_err(|_| AppError::invalid("the bundle has no manifest"))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    Ok(serde_json::from_slice(&buf)?)
}

pub struct ImportOptions {
    pub write_credentials: bool,
}

pub fn import(con: &mut Connection, path: &str, passphrase: &str, opts: &ImportOptions) -> AppResult<ImportSummary> {
    let sealed = std::fs::read(path)?;
    let plain = open(&sealed, passphrase)?;
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(plain))
        .map_err(|e| AppError::invalid(format!("the bundle is not readable: {e}")))?;

    let read = |zip: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>, name: &str| -> AppResult<Vec<u8>> {
        let mut f = zip.by_name(name).map_err(|_| AppError::invalid(format!("the bundle has no {name}")))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf)?;
        Ok(buf)
    };
    let manifest_bytes = read(&mut zip, "manifest.json")?;
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)?;
    let sig_bytes = read(&mut zip, "signature")?;
    let signature_ok = (|| -> Option<bool> {
        let pk = base64::engine::general_purpose::STANDARD.decode(&manifest.signer_public_key).ok()?;
        let pk: [u8; 32] = pk.try_into().ok()?;
        let vk = VerifyingKey::from_bytes(&pk).ok()?;
        let sig: [u8; 64] = sig_bytes.as_slice().try_into().ok()?;
        Some(vk.verify(&manifest_bytes, &Signature::from_bytes(&sig)).is_ok())
    })().unwrap_or(false);
    if !signature_ok {
        return Err(AppError::invalid("the bundle's signature does not match its manifest"));
    }

    let mut summary = ImportSummary {
        device_id: manifest.device_id.clone(), created_at: manifest.created_at.clone(), signature_ok, ..Default::default()
    };

    // Documents first (dedupe by hash), so rows never point at bytes that
    // are not here.
    let names: Vec<String> = zip.file_names().map(str::to_string).collect();
    for name in names.iter().filter(|n| n.starts_with("documents/")) {
        let hash = &name["documents/".len()..];
        if hash.len() != 64 { continue; }
        if crate::repo::documents::blob_exists(con, hash)? {
            summary.documents_already_held += 1;
            continue;
        }
        let bytes = read(&mut zip, name)?;
        let stored = crate::repo::documents::store_blob(con, &bytes)?;
        if stored != hash {
            summary.errors.push(format!("document {hash} did not hash to its name; skipped"));
            con.execute("DELETE FROM document_blobs WHERE file_hash = ?1", [stored])?;
            continue;
        }
        summary.documents_added += 1;
    }

    let snap: Snapshot = serde_json::from_slice(&read(&mut zip, "snapshot.json")?)?;
    let report = snapshot::load(con, &snap)?;
    summary.rows_written = report.written;
    summary.rows_kept_local = report.kept_local;
    summary.errors.extend(report.errors);

    if let Ok(tail) = read(&mut zip, "ledger.jsonl") {
        let entries: Vec<Entry> = String::from_utf8_lossy(&tail).lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok()).collect();
        if !entries.is_empty() {
            let r = ledger::apply(con, &entries)?;
            summary.ledger_applied = r.applied;
            summary.errors.extend(r.errors);
        }
    }

    if manifest.includes_credentials && opts.write_credentials {
        if let Ok(bytes) = read(&mut zip, "credentials.json") {
            let creds: BTreeMap<String, String> = serde_json::from_slice(&bytes)?;
            for (login, pw) in creds {
                if crate::keychain::save_portal_password(&login, &pw).is_ok() { summary.credentials_written += 1; }
            }
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passphrase_policy() {
        assert!(passphrase_strong_enough("short1!").is_err());
        assert!(passphrase_strong_enough("longenoughbutletters").is_err());
        assert!(passphrase_strong_enough("correct horse 7 battery!").is_ok());
    }

    /// Export from one device, import into a fresh one: rows, the document
    /// and the cursor arrive; a second import changes nothing (merge, never
    /// overwrite); a local edit made in between survives when it is newer.
    #[test]
    fn export_import_round_trip_is_a_merge() {
        use crate::repo::{clients, documents, local};
        let dir = std::env::temp_dir().join(format!("draftax-bundle-{}", crate::ids::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.draftax");

        let mut a = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut a).unwrap();
        local::set(&a, local::DEVICE_ID, "dev_a").unwrap();
        let c = clients::create_minimal(&a, "ABCDE1234F", Some("Example")).unwrap();
        documents::attach_stored(&a, &documents::Attach {
            parent_type: "proceeding", parent_id: "p-unknown", doc_kind: "annexure", filename: Some("x.pdf"),
            bytes: b"%PDF-bundle", source_url: None, fetched_at: None }).unwrap();
        let summary = export(&a, path.to_str().unwrap(), "pass phrase 1!", &ExportOptions { include_documents: true, include_credentials: false }).unwrap();
        assert_eq!(summary.documents, 1);

        let mut b = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut b).unwrap();
        local::set(&b, local::DEVICE_ID, "dev_b").unwrap();
        let first = import(&mut b, path.to_str().unwrap(), "pass phrase 1!", &ImportOptions { write_credentials: false }).unwrap();
        assert!(first.signature_ok);
        assert_eq!(first.documents_added, 1);
        assert!(first.rows_written >= 1);
        assert_eq!(clients::find_by_pan(&b, "ABCDE1234F").unwrap().unwrap().id, c.id);

        // B edits the client later than A's version; a re-import keeps B's edit.
        let mut cb = clients::get(&b, &c.id).unwrap().unwrap();
        cb.name = "Edited on B".into();
        cb.updated_at = "2099-01-01T00:00:00.000Z".into();
        clients::save(&b, &cb).unwrap();
        let second = import(&mut b, path.to_str().unwrap(), "pass phrase 1!", &ImportOptions { write_credentials: false }).unwrap();
        assert_eq!(second.documents_added, 0);
        assert_eq!(second.documents_already_held, 1);
        assert_eq!(clients::get(&b, &c.id).unwrap().unwrap().name, "Edited on B");
        let n: i64 = b.query_row("SELECT count(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn seal_and_open_round_trip_and_reject_wrong_passphrase() {
        let sealed = seal(b"hello", "pass phrase 1!").unwrap();
        assert_eq!(open(&sealed, "pass phrase 1!").unwrap(), b"hello");
        assert!(open(&sealed, "pass phrase 2!").is_err());
        assert!(open(b"not a bundle", "x").is_err());
    }
}
