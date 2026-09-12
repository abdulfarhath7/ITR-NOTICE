# TASKS.md

Work top to bottom. Do not reorder phases. Tick a box only when the
acceptance criteria pass and the app still builds.

Legend: `[ ]` todo · `[x]` done · `[~]` partially done, see NOTES.md

---

## Phase 0 — Groundwork

- [x] **0.1** Inspect the repository. Produce `docs/99-repo-map.md`: what exists, what runs, what is dead code. Do not delete anything yet.
  - *Done when:* the map lists every top-level directory with a one-line purpose and a live/dead verdict.
- [x] **0.2** Get the existing desktop app building and starting on this machine. Record the exact commands in `docs/99-repo-map.md`.
  - *Done when:* a documented command sequence produces a running window.
- [ ] **0.3** Introduce `migrations/` with a forward-only numbered runner. Baseline the current schema as `0001_baseline.sql`.
  - *Done when:* a fresh database can be built from migrations alone.
- [ ] **0.4** Add `NOTES.md` session 1 entry and commit the docs bundle.
- [ ] **0.5** Set up a `scripts/check.sh` that runs build, typecheck and lint for every workspace. Wire it into CI.
  - *Done when:* `./scripts/check.sh` exits 0.

## Phase 1 — Data model: the work-item spine

Read `docs/02-data-model.md` in full first.

- [ ] **1.1** Migration: `clients`, `year_contexts`. Move assessment year off proceedings and onto `year_contexts`.
- [ ] **1.2** Migration: `type_registry` plus seed rows for proceeding types, communication types, form types, demand reason codes.
  - *Done when:* adding a new proceeding type requires only an INSERT.
- [ ] **1.3** Migration: `proceedings` with `section_2025`, `section_1961`, `limitation_date`, `authority`, `source_panel`, `created_mode`, `status`, `verified_flag`, `gap_flags`.
- [ ] **1.4** Migration: `communications` (direction inbound) and `responses` (direction outbound, nullable `in_reply_to`, `response_mode`).
- [ ] **1.5** Migration: `adjournment_requests`.
- [ ] **1.6** Migration: `documents` — one polymorphic store, `doc_kind`, `parent_type`, `parent_id`, `file_hash`, `source_url`, `fetched_at`, `page_count`, `verified_flag`.
- [ ] **1.7** Migration: `ingestion_runs` — `run_at`, `panel_swept`, `records_found`, `gaps`, `operator`, `status`.
- [ ] **1.8** Backfill existing notice rows into the new shape. No data loss.
  - *Done when:* row counts before and after reconcile, and a spot check of ten notices matches.
- [ ] **1.9** Update all read paths to the new schema. Delete the old tables in a separate migration only after the app runs green.

## Phase 2 — Known bugs and the status state machine

Read `docs/15-known-bugs.md`.

- [ ] **2.1** Replace the open/closed boolean with the status state machine from `docs/02-data-model.md`.
- [ ] **2.2** Implement the action matrix. Closed and submitted items keep View and Save; only Draft is withheld.
  - *Done when:* a closed proceeding shows View and Save, and no Draft button.
- [ ] **2.3** Fix negative due dates. Store dates as date-only, compute in IST, render sign-aware strings.
  - *Done when:* no view can ever render a raw negative number of days.
- [ ] **2.4** Add a date-parsing test fixture with a day-of-month above 12 to catch DD/MM versus MM/DD inversion.
- [ ] **2.5** Status must win over dates: a closed item never renders as overdue.
- [ ] **2.6** Render `NULL` due dates as "not stated" everywhere, never as a blank cell or an epoch date.

## Phase 3 — Clients and credentials

- [ ] **3.1** Client registry screen per `docs/09-ui-spec.md`.
- [ ] **3.2** Add-client form. GSTIN input derives PAN from characters 3 to 12 and state from characters 1 to 2. Both stay editable.
- [ ] **3.3** Credential handling per `docs/07-security.md`. Passwords go to the OS keychain, never the database, never a log.
  - *Done when:* grepping the repo and the database file for a test password returns nothing.
- [ ] **3.4** `clients.portal_login_ref` — a client may be reachable through an AR login rather than its own credentials.
- [ ] **3.5** Client import from CSV, with a dry-run preview and a per-row error list.
- [ ] **3.6** Client detail view: year contexts down the side, modules across.

## Phase 4 — Ingestion service, e-Proceedings

Read `docs/05-ingestion.md` and `docs/06-source-interface.md`.

- [ ] **4.1** Define the `NoticeSource` trait/interface: `login`, `list_work_items`, `fetch_item`, `health`. Playwright is one implementation.
- [ ] **4.2** Job queue in SQLite: one job per client per module, with attempts, backoff, and a resume cursor.
- [ ] **4.3** Attended login flow. The queue pauses for captcha and OTP and waits without failing or timing out the job.
- [ ] **4.4** Sweep all six panels. Record zero counts explicitly as an `ingestion_runs` row, never skip.
- [ ] **4.5** Per-client lock, five minutes, renewable, so no two devices open one taxpayer's session.
- [ ] **4.6** Anchored selectors plus a per-field confidence flag. Low confidence sets `verified_flag = false`.
- [ ] **4.7** Document-first storage: fetch the PDF, hash it, store it, then write the index row referencing it.
- [ ] **4.8** Early-stop delta walk — stop a client after ten consecutive rows whose hash is already stored and unchanged.
- [ ] **4.9** Resumability: kill the process mid-run and restart; it must continue from the last completed client, not the beginning.
- [ ] **4.10** Ingestion monitor screen: current client, queue position, panel being swept, pause and resume.

## Phase 5 — Modules 2, 3 and 4

- [ ] **5.1** Migration and ingestion for `demands`, `demand_responses`, `payments` per `docs/02-data-model.md`.
- [ ] **5.2** Migration and ingestion for `returns`, including `supersedes_id` chaining of revised and updated returns.
- [ ] **5.3** Migration and ingestion for `filed_forms`, grouped for display by form type from the registry.
- [ ] **5.4** Form-and-receipt pair rule: both nodes always exist; an awaited receipt is a pending node, never an absent one.
- [ ] **5.5** Per-module sweep cadence, configurable, defaults in `QUESTIONS.md` Q12.
- [ ] **5.6** Unified attention list across all four modules, ranked per `docs/09-ui-spec.md`.

## Phase 6 — Change ledger, snapshots, file transfer

Read `docs/03-sync-and-ledger.md`.

- [ ] **6.1** `ledger` table: `device_id`, `seq`, `op`, `entity_type`, `entity_id`, `payload`, `created_at`.
- [ ] **6.2** Every write to a synced table appends a ledger entry in the same transaction.
- [ ] **6.3** Device cursor as a map of `device_id` to last applied `seq`. Persist it.
- [ ] **6.4** Apply logic: idempotent, order-safe within a stream, resumable mid-changeset.
- [ ] **6.5** Snapshot builder — compacted state plus the tail, per Q07 cadence.
- [ ] **6.6** Encrypted `.draftax` bundle export: manifest, snapshot, ledger tail, content-addressed documents.
- [ ] **6.7** Bundle import: merge, never overwrite. Match clients by PAN. Newest scraped-at wins per row. Documents deduplicated by hash.
- [ ] **6.8** Export excludes credentials by default; including them requires a second confirmation and a strong passphrase.

## Phase 7 — Relay, devices, roles

Read `docs/04-roles-and-devices.md`.

- [ ] **7.1** `relay/` FastAPI service: firm registration, device enrolment, blob put and get by cursor, lease endpoints.
- [ ] **7.2** Firm bootstrap: the first user to activate becomes admin, recorded server-side. The server refuses a second admin.
- [ ] **7.3** Admin recovery code, shown once at setup, with a confirm-you-saved-it step.
- [ ] **7.4** Collector lease: issue, renew, revoke, expire. Only the holder may publish sweep changesets.
- [ ] **7.5** Device roster screen. Admin sees the radio control; everyone else sees the same list read-only.
- [ ] **7.6** Collector handoff: drain the current client, revoke, reissue, new device catches up before it runs.
- [ ] **7.7** Sync button with the three states in `docs/09-ui-spec.md`, including collector-silent detection separate from cursor freshness.
- [ ] **7.8** "Changes behind" indicator, broken down by originating device.
- [ ] **7.9** On-demand single-client refresh, routed locally for scraper clients.

## Phase 8 — Exports and reports

Read `docs/11-exports.md`.

- [ ] **8.1** Excel export, proceedings sheet, exactly the 17 columns in the given order.
- [ ] **8.2** Multi-sheet workbook: one tab per module.
- [ ] **8.3** Export scope selector: current filtered view, all clients, single client.
- [ ] **8.4** Export header block stamping device cursor and collector last-run time.
- [ ] **8.5** User-entered columns (`client_code`, `manual_due_date`, `client_file_no`) are editable in-app and sync upward.

## Phase 9 — AI drafting

- [ ] **9.1** Draft generation through the server-side proxy. Cache per notice. Never call twice for the same notice.
- [ ] **9.2** Suggested due date writes only to `suggested_due_date` with `verified_flag = false`. Promotion requires an explicit user action.
- [ ] **9.3** Draft review screen: source notice on one side, draft on the other, edit before use.
- [ ] **9.4** No draft button on submitted or closed items.

## Phase 10 — Packaging and release

- [ ] **10.1** Windows build via the existing CI workflow. Fix the sidecar target-triple packaging issue if it recurs.
- [ ] **10.2** First-run wizard: firm setup, admin creation, recovery code, collector nomination.
- [ ] **10.3** Settings screen: sweep cadence, worker count, data folder, about.
- [ ] **10.4** Write `docs/USER-GUIDE.md` in plain language, no jargon.
- [ ] **10.5** Final pass: update `TASKS.md`, `NOTES.md`, `QUESTIONS.md`, `DECISIONS.md`.
