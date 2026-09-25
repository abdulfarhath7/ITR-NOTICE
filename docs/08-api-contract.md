# 08 — API contract

Two surfaces: Tauri commands (frontend to Rust core) and the relay HTTP API
(devices to relay). Keep both small.

## Conventions

- Tauri commands are `snake_case` verbs: `list_clients`, `start_ingestion_run`.
- Every command returns `Result<T, AppError>`; `AppError` has a stable `code`,
  a human `message` and an optional `detail`.
- Never return a raw database row. Define an explicit DTO per command.
- Dates cross the boundary as ISO strings, never as epoch numbers.
- No command returns a secret. Ever.

## Tauri commands

### Clients
```
list_clients(filter) -> ClientSummary[]
get_client(id) -> ClientDetail
create_client(input) -> ClientDetail
update_client(id, patch) -> ClientDetail
derive_from_gstin(gstin) -> { pan, state_code, state_name }
import_clients_csv(path, dry_run) -> { ok: Row[], errors: RowError[] }
```

Build 3 additions:
```
client_delete_preview(client_id) -> { name, years, work_items, communications, documents, login_shared }
delete_client(client_id)       // children first, each a ledgered delete; refused while a run is in flight
```

### Statutory calendar (Build 5, docs/19 §9)
```
list_statutory(from, to, scope?)      -> StatutoryItem[]   // statutory + firm rows in force; applies_count under scope=applies
refresh_statutory()                   -> FetchOutcome[]    // plain HTTPS, no credentials, one row per year
statutory_status()                    -> { last_fetched_at, last_status, last_error, last_ok_at, deadlines, years, next_due }
get_calendar_settings() / set_calendar_settings(settings)
list_firm_dates() / upsert_firm_date(id?, due_on, title, note?) / delete_firm_date(id)
export_statutory_ics(fy_start_year, path) -> path         // statutory and firm layers only
set_client_calendar_profile(client_id, entity_kind?, audit_case, tp_case, tds_deductor)
```

### Work items
```
list_work_items(filter) -> WorkItemRow[]      // across all four modules
get_proceeding(id) -> ProceedingDetail
get_demand(id) -> DemandDetail
get_return(id) -> ReturnDetail
get_filed_form(id) -> FiledFormDetail
set_manual_due_date(proceeding_id, date | null)
set_client_file_no(client_id, value)
get_work_item_meta(module, id) -> WorkItemMeta | null     // Build 2
set_work_item_meta(module, id, assignee?, note?) -> WorkItemMeta   // "" clears
list_assignees() -> string[]
set_client_sync_enabled(client_id, enabled)
set_client_note(client_id, note)
```
`WorkItemRow` also carries `issued_on`, `assignee`, `has_note`,
`drafts_to_review` and, for demands, `amount`. `ClientDetail` carries
`last_sync_at`, `sync_enabled`, `note`.

### Documents
```
open_document(document_id) -> ()            // opens in the OS viewer
save_document_as(document_id, path) -> ()
```
Both are available for every status. Only `create_draft` is status-gated.

### Ingestion
```
start_ingestion_run(scope) -> run_id         // scope: all | module | client | clients {client_ids}
pause_ingestion_run() / resume_ingestion_run()
get_ingestion_state() -> { current_client, queue_pos, panel, awaiting_operator }
submit_login_challenge(run_id, kind, value)  // captcha text or OTP
refresh_client(client_id) -> run_id          // single client, any device
get_sync_line() -> { last_run_at, window_start, clients, failed }
list_updates(since?) -> { since, entries: UpdateEntry[] }   // read-only diff of the ledger
                                             // groups add history_fetched (docs/17)
```

### Scrape scopes (Build 3, docs/17 §7)
```
request_deep_fetch(client_id, depth, depth_value?, modules, docs_policy, mode)
    -> { request, status: started|queued, sweep_id? }  // replaces a queued one; `now` starts it
cancel_deep_fetch(id)                        // queued only
retry_deep_fetch(id)                         // failed only; back to tonight
list_deep_fetch_requests() -> DeepFetchRequest[]
fetch_item(module, id, queue_if_busy?) -> { status: started|queued|busy, sweep_id? }
sweep_estimate(client_ids?) -> seconds       // none = every sweep-enabled client
deep_estimate(client_id, depth, depth_value?) -> seconds
get_sweep_settings() -> SweepSettings        // superset of get_sweep_schedule
set_sweep_settings(settings)
set_client_sync(client_id, enabled, reason?) // extends set_client_sync_enabled
pin_client_cadence(client_id, pinned)
get_sync_overview() -> { run?, last_summary?, window, next_run_at?, estimate_all_s, rows: SyncRow[] }
get_last_sweep_summary() -> { sweep_id, started_at, finished_at, summary }?
```
Every `ingestion` event now carries `scope: sweep|deep|item`. The run ends
with a `summary` event. `create_client` accepts `fetch_history_tonight`,
which queues an `all / index / tonight` request.
`submit_login_challenge` never logs `value`.

### Sync and devices
```
get_sync_state() -> { cursor, behind_by_device, collector_last_seen, healthy }
sync_now() -> SyncResult
list_devices() -> DeviceRow[]
set_collector(device_id) -> ()               // admin only
remove_device(device_id) -> ()               // admin only
transfer_admin(user_id) -> ()                // admin only
export_bundle(path, include_credentials, passphrase) -> ()
import_bundle(path, passphrase) -> ImportSummary
```

### Export and AI
```
export_excel(scope, path) -> ()
export_updates(since?, path) -> count          // one sheet per Updates group
set_draft_reviewed(notice_id, reviewed) -> ()
create_draft(notice_id) -> Draft              // cached; never called twice
suggest_due_date(notice_id) -> Suggestion     // writes suggested_due_date only
promote_suggested_due_date(proceeding_id) -> ()   // explicit human action
```

## Relay HTTP API

All bodies are opaque ciphertext except where noted. Auth is a device Ed25519
signature over the request. The relay never sees a plaintext record.

```
POST /v1/firms                      register a firm, returns firm_id
POST /v1/firms/{id}/devices         enrol a device, returns device_id
GET  /v1/firms/{id}/devices         roster metadata (names, last_seen, role)
POST /v1/firms/{id}/admin/transfer  admin only, enforced server-side
POST /v1/firms/{id}/admin/recover   recovery code flow

POST /v1/firms/{id}/lease           claim or renew the collector lease
DELETE /v1/firms/{id}/lease         release
GET  /v1/firms/{id}/lease           current holder and expiry

POST /v1/firms/{id}/locks/{client}  acquire a per-client session lock
DELETE /v1/firms/{id}/locks/{client}

POST /v1/firms/{id}/changesets      publish (sweep publish requires the lease)
GET  /v1/firms/{id}/changesets?cursor=...   fetch entries after a cursor map
GET  /v1/firms/{id}/snapshot/latest
POST /v1/firms/{id}/snapshot
```

### Server-enforced invariants

The relay must reject, not merely discourage:

- a second admin for a firm,
- a sweep changeset from a device that does not hold the lease,
- a lock acquisition for a client already locked,
- a device that has been removed from the roster.

Client-side checks are for user experience. These four are for correctness.
