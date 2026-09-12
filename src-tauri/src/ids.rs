//! Identity and time primitives shared by every table: UUIDv7 ids, ISO-8601
//! UTC timestamps with a `Z`, and SHA-256 for document identity and row
//! hashes.

use sha2::{Digest, Sha256};

pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// `2026-09-12T14:03:22.117Z` — what every `created_at`/`updated_at` holds.
pub fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// A row hash over the fields that matter for delta detection. Fields are
/// joined with a separator that cannot appear in portal text so that
/// ("ab", "c") and ("a", "bc") never collide.
pub fn row_hash(fields: &[Option<&str>]) -> String {
    let mut h = Sha256::new();
    for f in fields {
        match f {
            Some(v) => h.update(v.as_bytes()),
            None => h.update(b"\x00NULL"),
        }
        h.update(b"\x1f");
    }
    hex::encode(h.finalize())
}
