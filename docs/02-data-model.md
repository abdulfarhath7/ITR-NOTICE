# 02 — Data model

SQLite with SQLCipher. Forward-only numbered migrations in `migrations/`.
All ids are UUIDv7 text. All dates are `TEXT` ISO-8601 **date only**
(`YYYY-MM-DD`); all timestamps are ISO-8601 UTC with a `Z`. Day arithmetic is
performed in Asia/Kolkata.

## The spine

```
clients
  └── year_contexts            (assessment year + financial year)
        ├── proceedings        (assessments, appeals, standalone letters)
        │     ├── communications      (inbound, from the department)
        │     ├── responses           (outbound, from the firm)
        │     └── adjournment_requests
        ├── demands
        │     └── demand_responses
        ├── returns
        └── filed_forms

payments        → year_contexts, optionally demand_responses and proceedings
documents       → any object, exactly one parent
type_registry   → system-level configuration
ledger          → every write
ingestion_runs  → audit of every sweep
```

## Tables

### clients
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| client_code | TEXT | firm's own reference, unique per firm, user-entered (Q02) |
| name | TEXT | legal name |
| pan | TEXT | uppercase, 10 chars |
| gstin | TEXT NULL | PAN derivable from chars 3–12 |
| entity_type | TEXT | individual, company, firm, huf, trust, aop, other |
| client_group | TEXT NULL | for group-level views |
| phone_cc | TEXT | e.g. `+91` |
| phone | TEXT | |
| email | TEXT NULL | |
| portal_login_ref | TEXT NULL | which login reaches this client; null means own credentials |
| source | TEXT | `portal` or `eri` — per client, not global |
| client_file_no | TEXT NULL | user-entered (Q02) |
| tags | TEXT NULL | comma separated |
| sync_enabled | INTEGER | 1 default; 0 skips the client in whole-book and scheduled sweeps (0019) |
| note | TEXT NULL | firm-authored free text, synced (0020) |
| history_depth | TEXT | `recent` (default) · `partial` · `full`, set when a deep fetch completes (0022) |
| history_fetched_at | TEXT NULL | when the last deep fetch completed (0022) |
| history_note | TEXT NULL | "Last 2 AYs, index only" (0022) |
| cadence_tier | TEXT | `nightly` (default) · `weekly` for dormant clients (0022) |
| cadence_pinned | INTEGER | 1 keeps the client nightly; never auto-cleared (0022) |
| last_swept_at | TEXT NULL | end of the client's last sweep job (0022) |
| sync_pause_reason | TEXT NULL | why sync was turned off; empty when on (0022) |
| created_at, updated_at | TEXT | |

No password column. Ever. See `07-security.md`.

### year_contexts
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| client_id | TEXT FK | |
| assessment_year | TEXT | `2024-25` |
| financial_year | TEXT | `2023-24` — both held; some portal services key on FY |

Unique on `(client_id, assessment_year)`.

### proceedings
One table for assessments, appeals and standalone letter shells. Category
comes from the registry, not from a separate table.

| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| year_context_id | TEXT FK | |
| proceeding_type_id | TEXT FK → type_registry | |
| section_2025 | TEXT NULL | Income-tax Act 2025 reference |
| section_1961 | TEXT NULL | legacy reference, shown in brackets |
| din_reference | TEXT NULL | |
| authority | TEXT NULL | issuing or appellate authority |
| initiated_on | TEXT NULL | date; not populated by the portal engine (Q22: the card's stepper date is not read) |
| due_date | TEXT NULL | portal-stated response due date |
| manual_due_date | TEXT NULL | user-entered; may sit beside a portal date and then drives the worklist (Q14) |
| suggested_due_date | TEXT NULL | AI suggestion; never promoted automatically |
| limitation_date | TEXT NULL | statutory clock on the proceeding itself |
| status | TEXT | see state machine below |
| source_panel | TEXT | which of the six panels it came from |
| created_mode | TEXT | `auto` or `manual` (Q01) |
| appeal_number | TEXT NULL | populated for appeal category |
| order_appealed_against | TEXT NULL | |
| verified_flag | INTEGER | 0 or 1 |
| gap_flags | TEXT NULL | JSON array of column names the portal did not display |
| row_hash | TEXT | for delta detection; includes status and gap_flags |
| first_seen_at, last_seen_at | TEXT | |

`limitation_date` is the most important field in this table. It is not the
response deadline. It is the statutory clock, and it is what partners track.

### communications  (always inbound)
`id, proceeding_id, communication_type_id, section_2025, section_1961, din,
issued_on, response_due_date, status, direction='inbound', verified_flag,
gap_flags, row_hash`

### responses  (always outbound)
`id, proceeding_id, in_reply_to NULL, response_mode ('full'|'partial'),
filed_on, filed_by, remarks, transaction_id, direction='outbound'`

`in_reply_to` is nullable on purpose: a voluntary submission may exist with no
notice behind it.

### adjournment_requests
`id, proceeding_id, sought_date, reason, outcome, filed_on`

### demands
`id, year_context_id, demand_reference_number, demand_amount,
current_outstanding, section_or_demand_type, raised_on, uploaded_by,
rectification_rights, status, proceeding_id NULL, verified_flag, gap_flags,
row_hash`

`demand_amount` and `current_outstanding` are different numbers and must both
be stored.

### demand_responses
`id, demand_id, stance ('agreed'|'disagreed'|'partially_disagreed'),
reason_code_id FK → type_registry, disputed_amount, filed_on, transaction_id`

### payments  (Q03)
`id, year_context_id, demand_response_id NULL, proceeding_id NULL,
purpose ('demand_settlement'|'pre_deposit'|'self_assessment'|'other'),
cin, bsr_code, paid_on, amount`

Parent is the year context. The other two links are relationships, not
ownership, because a pre-deposit on appeal genuinely relates to both.

### returns
`id, year_context_id, acknowledgement_number, return_type, filing_type
('original'|'revised'|'updated'), filed_on, verification_status,
processing_status, supersedes_id NULL`

Revised and updated returns are siblings chained by `supersedes_id`, not
children.

### filed_forms
`id, year_context_id, form_type_id FK → type_registry, acknowledgement_number,
filed_on, filing_type, status, filed_by`

Stored flat, grouped for display by form type.

### documents
One store for every leaf. Exactly one parent.

`id, parent_type, parent_id, doc_kind, filename, file_hash, source_url,
fetched_at, page_count, byte_size, verified_flag, storage_path`

`doc_kind` ∈ `communication | response | annexure | form | receipt | challan |
order | intimation`.

**The form-and-receipt pair rule:** for returns and filed forms there are
always exactly two document nodes, never one and never three. If the receipt
is awaited, the node exists with `storage_path = NULL` and a pending state, so
a missing acknowledgement is visible rather than absent.

**States (docs/17 §5).** `stored`: has `file_hash` and `storage_path`.
`pending`: not fetched yet. An index-only sweep creates it with
`source_url = 'portal:<parent_type>:<reference>'`, and an item fetch fills
it. `failed`: the portal offered no file. A stored document is never demoted
to pending.

A processing intimation is not a third node. It belongs to the proceeding or
demand it creates, cross-referenced back to the return.

### type_registry
`id, registry_name, code, label, category, statute, field_template,
status_set, sort_order, active`

`registry_name` ∈ `proceeding_type | communication_type | form_type |
demand_reason_code`.

This table carries the extension load. **A new proceeding type, form type or
reason code must be an INSERT, never a schema change and never a release.**
If you find yourself editing an enum in code to add a type, you have taken a
wrong turn.

### ingestion_runs
`id, run_at, device_id, client_id, module, panel_swept, records_found, gaps,
operator, status, notes, scope`

`scope` ∈ `sweep | deep | item` (0022) says which kind of run wrote it. A
probe-skipped client writes one row with `panel_swept = NULL` and
`notes = 'unchanged'`. `gaps` now also carries `indexed` and
`older_than_window` counts per panel.

A sweep that found nothing writes a row with `records_found = 0`. Zero counts
are evidence; skipping is not.

### ingestion_sweeps.scope and .sweep_summary  (0011, 0022)
`scope` is JSON: `{"kind": "sweep"|"deep"|"item", "selector": {"kind": "all"|"module"|"client", ...},
"scheduled": bool, "deep_request_id"?, "item"?: {"module", "id"}}`. Rows that
predate 0022 were rewritten as sweeps. `sweep_summary` is
`{swept, skipped_unchanged, failed, parked, deep_done, warm_cached,
duration_s, window_closed}`, written when a sweep finishes or stops.

`ingestion_jobs.cursor` gains `unchanged: true` when the probe skipped the job.

### probe_state  (0022, local)
`login_ref, panel, list_hash, rows, checked_at`, primary key
`(login_ref, panel)`. It holds the list hash from the last completed walk and
is never synced.

### deep_fetch_requests  (0022, local)
`id, client_id, depth (all|years|since), depth_value, modules (JSON),
docs_policy (index|download), mode (tonight|now), status
(queued|running|done|failed|cancelled), requested_by, requested_at,
started_at, finished_at, progress (JSON), last_error`. Queuing a request for
a client replaces that client's queued one.

### statutory_deadlines  (Build 5, migration 0024, docs/19 §2.2)
`id` (sha256(source date ‖ normalised title)[:16]), `due_on`, `original_on`,
`title`, `category`, `note`, `circular`, `applies` (JSON tags),
`source_year`, `first_seen_at`, `last_seen_at`, `removed_at`. Written only
by the fetcher; never deleted, `removed_at` marks a row that left the
portal page. Synced.

### statutory_fetches  (0024)
One row per fetch attempt per calendar year: `status` ok · unchanged ·
failed, `page_hash`, `rows`, `error` (masked). Synced.

### statutory_events  (0024)
One immutable row per fetch change: `kind` statutory_added ·
statutory_extended · statutory_removed · statutory_unparsed, JSON
`payload` {title, from, to, circular, note, category}, `at`. The Updates
screen's "Deadline extended" and "Calendar changed" groups read it. Synced.

### firm_dates  (0024)
User-authored dates on the calendar: `due_on`, `title`, `category`
(`firm`), `note`, `created_by`. Synced like `work_item_meta`.

### clients — calendar profile  (0024)
`entity_kind` (individual · huf · firm · llp · company · trust · other,
NULL until set), `audit_case`, `tp_case`, `tds_deductor` (0/1). Set by a
person on the Profile tab, never inferred; the calendar's Applies-to-us
scope reads them (docs/19 §2.4).

### ledger
See `03-sync-and-ledger.md`.

### ledger_received  (migration 0021, Q39)
Local, never synced. Every entry `ledger::apply` applies from another device,
under the local id it merged into, plus `received_at`. The Updates screen
diffs it with this device's own `ledger`.

### work_item_meta  (Build 2, migration 0017)
| column | type | notes |
|---|---|---|
| id | TEXT PK | `module:item_id`, also the ledger entity id (D-038) |
| module | TEXT | proceedings, demands, returns, forms |
| item_id | TEXT | the item's id; unique with module |
| assignee | TEXT NULL | display name, free text, no user table |
| note | TEXT NULL | plain text |
| updated_by | TEXT NULL | device id |
| created_at, updated_at | TEXT | |

Person-authored only; the scraper never writes it. Synced like any table.

### drafts.reviewed_at  (migration 0018)
Nullable timestamp set by "Mark reviewed"; cleared when the draft is
generated again. Drives the Attention "Drafts to review" tile.

## Status state machine

Do not model status as a boolean. The prior open/closed boolean caused both
known bugs in `15-known-bugs.md`.

```
          open ──────────► response_submitted ──────► closed
            │                                           ▲
            └──────────────► closed (no response) ──────┘
          open ──► adjournment_sought ──► open
```

Allowed statuses: `open`, `adjournment_sought`, `response_submitted`,
`closed`, `unknown`.

### Action matrix — enforce this in one place

| status | View | Save | Draft | Edit manual due date |
|---|---|---|---|---|
| open | yes | yes | yes | yes |
| adjournment_sought | yes | yes | yes | yes |
| response_submitted | yes | yes | no | no |
| closed | yes | yes | no | no |
| unknown | yes | yes | no | yes |

Every status appears in exports. Only the attention list filters by status.

## Verification and gaps

Two separate ideas, both required:

- `verified_flag` — has a human confirmed this record? Machine-read values
  start at 0.
- `gap_flags` — a JSON array of columns the portal simply did not display.

A field in `gap_flags` renders as "not stated". It never renders as blank, as
zero, or as a guessed value. A due date is a statutory limitation; a wrong one
is worse than none.

## Which due date drives the worklist (Q14)

`manual_due_date`, when a person entered one, is the effective due date for
the Attention ranking, the overdue calculation and every due cell; the
portal's `due_date` is shown beside it, labelled, and exported in its own
column. A promoted AI suggestion writes `manual_due_date`, never `due_date`.
The portal's field is never overwritten.
