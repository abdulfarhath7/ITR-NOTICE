# migrations/

Forward-only, numbered SQL. `NNNN_description.sql`. Never edit a migration
that has shipped; add a new one.

The Rust core embeds every file listed in `src-tauri/src/migrate.rs` at
compile time and applies the ones a database has not seen, in order, each in
its own transaction, recording the version in `schema_migrations`. Adding a
migration means adding the file **and** its line in `migrate.rs` — the list
is explicit on purpose so a stray file can never run.

Rules (from `docs/13-conventions.md`):

- every foreign key declared and indexed,
- every table has `created_at`; every mutable table has `updated_at`,
- ids are UUIDv7 text, dates are `YYYY-MM-DD`, timestamps ISO-8601 UTC `Z`.

`0001_baseline.sql` is the schema the desktop app had before this build
started. It uses `IF NOT EXISTS` so an archive created by that code adopts
version 1 without change.
