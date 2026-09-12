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

### Work items
```
list_work_items(filter) -> WorkItemRow[]      // across all four modules
get_proceeding(id) -> ProceedingDetail
get_demand(id) -> DemandDetail
get_return(id) -> ReturnDetail
get_filed_form(id) -> FiledFormDetail
set_manual_due_date(proceeding_id, date | null)
set_client_file_no(client_id, value)
```

### Documents
```
open_document(document_id) -> ()            // opens in the OS viewer
save_document_as(document_id, path) -> ()
```
Both are available for every status. Only `create_draft` is status-gated.

### Ingestion
```
start_ingestion_run(scope) -> run_id         // scope: all | module | client
pause_ingestion_run() / resume_ingestion_run()
get_ingestion_state() -> { current_client, queue_pos, panel, awaiting_operator }
submit_login_challenge(run_id, kind, value)  // captcha text or OTP
refresh_client(client_id) -> run_id          // single client, any device
```
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
