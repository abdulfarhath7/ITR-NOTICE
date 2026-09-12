//! Forward-only schema migrations. Every file in `migrations/` that should
//! run is listed in `MIGRATIONS` and embedded at compile time; a database
//! records what it has applied in `schema_migrations`, and `run` applies the
//! rest in order, one transaction each.
//!
//! The list is explicit rather than globbed so a stray file in the folder can
//! never reach a user's archive.

use rusqlite::{params, Connection};
use thiserror::Error;

pub struct Migration {
    pub version: u32,
    pub name: &'static str,
    pub sql: &'static str,
}

macro_rules! migration {
    ($version:expr, $name:literal, $file:literal) => {
        Migration { version: $version, name: $name, sql: include_str!(concat!("../../migrations/", $file)) }
    };
}

pub const MIGRATIONS: &[Migration] = &[
    migration!(1, "baseline", "0001_baseline.sql"),
];

#[derive(Debug, Error)]
pub enum MigrateError {
    #[error("database error while migrating: {0}")]
    Db(#[from] rusqlite::Error),
    /// The archive was written by a newer build. Opening it with this one
    /// would silently misread new columns, so refuse.
    #[error("archive is at schema version {found}, this build knows up to {known} - update the app")]
    TooNew { found: u32, known: u32 },
    /// `MIGRATIONS` must be 1, 2, 3 ... with no gaps; anything else is a
    /// programming error caught at startup, not a runtime condition.
    #[error("migration list is not contiguous at version {0}")]
    NotContiguous(u32),
}

/// Bring `con` up to the latest version this build knows. Safe to call on
/// every open; a current database is a single SELECT.
pub fn run(con: &mut Connection) -> Result<u32, MigrateError> {
    con.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             version    INTEGER PRIMARY KEY,
             name       TEXT NOT NULL,
             applied_at TEXT NOT NULL
         );",
    )?;

    for (i, m) in MIGRATIONS.iter().enumerate() {
        if m.version != i as u32 + 1 {
            return Err(MigrateError::NotContiguous(m.version));
        }
    }
    let known = MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    let current = current_version(con)?;
    if current > known {
        return Err(MigrateError::TooNew { found: current, known });
    }

    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = con.transaction()?;
        tx.execute_batch(m.sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, applied_at)
             VALUES (?1, ?2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![m.version, m.name],
        )?;
        tx.commit()?;
    }
    Ok(known)
}

pub fn current_version(con: &Connection) -> Result<u32, rusqlite::Error> {
    con.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Acceptance for task 0.3: a fresh database is built from the migration
    /// files alone, and running again is a no-op.
    #[test]
    fn fresh_database_builds_from_migrations() {
        let mut con = Connection::open_in_memory().unwrap();
        let v = run(&mut con).unwrap();
        assert_eq!(v, MIGRATIONS.last().unwrap().version);
        assert_eq!(current_version(&con).unwrap(), v);
        let tables: Vec<String> = con
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        for required in ["proceedings", "notices", "drafts", "runs", "schema_migrations"] {
            assert!(tables.iter().any(|t| t == required), "missing table {required}");
        }
        // idempotent
        assert_eq!(run(&mut con).unwrap(), v);
    }

    /// An archive created by the pre-migration code (tables already there,
    /// no schema_migrations) adopts version 1 without error.
    #[test]
    fn legacy_archive_adopts_baseline() {
        let mut con = Connection::open_in_memory().unwrap();
        con.execute_batch(MIGRATIONS[0].sql).unwrap();
        assert_eq!(run(&mut con).unwrap(), MIGRATIONS.last().unwrap().version);
    }
}
