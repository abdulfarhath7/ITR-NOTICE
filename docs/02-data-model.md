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
operator, status, notes`

A sweep that found nothing writes a row with `records_found = 0`. Zero counts
are evidence; skipping is not.

### ledger
See `03-sync-and-ledger.md`.

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
