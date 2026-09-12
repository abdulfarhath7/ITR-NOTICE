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
    pub step: Step,
}

/// A migration is either a SQL file or, when the shape change needs ids,
/// hashes or parsing SQL cannot do, a Rust function run inside the same
/// transaction.
pub enum Step {
    Sql(&'static str),
    Code(fn(&rusqlite::Transaction) -> Result<(), MigrateError>),
}

macro_rules! sql {
    ($version:expr, $name:literal, $file:literal) => {
        Migration { version: $version, name: $name,
                    step: Step::Sql(include_str!(concat!("../../migrations/", $file))) }
    };
}
macro_rules! code {
    ($version:expr, $name:literal, $f:path) => {
        Migration { version: $version, name: $name, step: Step::Code($f) }
    };
}

pub const MIGRATIONS: &[Migration] = &[
    sql!(1, "baseline", "0001_baseline.sql"),
    sql!(2, "clients_year_contexts", "0002_clients_year_contexts.sql"),
    sql!(3, "type_registry", "0003_type_registry.sql"),
    sql!(4, "proceedings", "0004_proceedings.sql"),
    sql!(5, "communications_responses", "0005_communications_responses.sql"),
    sql!(6, "adjournment_requests", "0006_adjournment_requests.sql"),
    sql!(7, "documents", "0007_documents.sql"),
    sql!(8, "ingestion_runs_drafts", "0008_ingestion_runs_drafts.sql"),
    code!(9, "backfill_legacy_notices", crate::backfill::run),
    sql!(10, "drop_legacy", "0010_drop_legacy.sql"),
    sql!(11, "ingestion_queue", "0011_ingestion_queue.sql"),
    sql!(12, "responses_mode_nullable", "0012_responses_mode_nullable.sql"),
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
    /// A code migration found data it cannot carry across without loss.
    #[error("migration {version} refused: {reason}")]
    Refused { version: u32, reason: String },
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
        match m.step {
            Step::Sql(sql) => tx.execute_batch(sql)?,
            Step::Code(f) => f(&tx)?,
        }
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
        for required in ["clients", "year_contexts", "type_registry", "proceedings", "communications",
                         "responses", "adjournment_requests", "documents", "document_blobs",
                         "ingestion_runs", "drafts", "local_kv", "schema_migrations"] {
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
        let Step::Sql(baseline) = MIGRATIONS[0].step else { panic!("baseline is SQL") };
        con.execute_batch(baseline).unwrap();
        assert_eq!(run(&mut con).unwrap(), MIGRATIONS.last().unwrap().version);
    }
}
