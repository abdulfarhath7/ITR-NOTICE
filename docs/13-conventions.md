# 13 — Conventions

## Repository layout

```
app/            existing FastAPI web tool (dev harness)
relay/          FastAPI relay service
src-tauri/      Rust core
src/            React + TypeScript frontend
sidecar/        Python Playwright ingestion
migrations/     numbered forward-only SQL
docs/           this specification
scripts/        check.sh, fixtures, release helpers
```

## Naming

| Thing | Style | Example |
|---|---|---|
| SQL tables and columns | snake_case, plural tables | `year_contexts`, `due_date` |
| Rust | snake_case fns, PascalCase types | `list_work_items`, `WorkItemRow` |
| TypeScript | camelCase, PascalCase components | `listWorkItems`, `AttentionTable` |
| Tauri commands | snake_case verbs | `start_ingestion_run` |
| Files (TS) | kebab-case | `attention-table.tsx` |
| Migrations | `NNNN_description.sql` | `0007_add_limitation_date.sql` |

Domain terms keep their domain spelling in code: `pan`, `gstin`, `din`,
`assessment_year`, `challan`. Do not anglicise them.

## Rust

- `thiserror` for error types, one per module, converging on `AppError` at the
  command boundary.
- No `unwrap()` or `expect()` outside tests and startup.
- All database access through a repository module. No SQL in command handlers.
- Every write that touches a synced table goes through the one function that
  also appends the ledger entry.

## TypeScript

- `strict: true`. No `any`. No non-null assertions.
- Server state through a query layer; no data fetching inside components.
- Components are presentational; logic lives in hooks.
- No inline styles except for computed values. Tokens from the design system.

## Python

- Type hints everywhere, checked.
- The sidecar speaks line-delimited JSON on stdio and never touches the
  database.
- No bare `except`.

## SQL

- Forward-only. Never edit a migration that has shipped.
- Every foreign key is declared and indexed.
- Every table has `created_at`; every mutable table has `updated_at`.

## Commits

Conventional commits. One task per commit where practical.
```
feat(ingestion): sweep all six e-Proceedings panels
fix(dates): render overdue instead of negative day counts
docs(questions): add Q21 on adjournment outcomes
```

## Comments

Explain why, never what. A comment restating the code is noise. A comment
explaining a portal quirk or a non-obvious ordering constraint is gold.

Use `TODO(blocked): <reason, see NOTES.md>` for anything you could not finish.
Nothing else gets a TODO.

## Logging

Structured, levelled. `info` for run lifecycle, `warn` for recoverable
problems, `error` for failures. Every log line that mentions a client uses the
client id, never the name. PAN is masked at the logging layer, not by callers.
