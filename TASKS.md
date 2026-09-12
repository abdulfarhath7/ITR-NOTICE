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
- [x] **0.3** Introduce `migrations/` with a forward-only numbered runner. Baseline the current schema as `0001_baseline.sql`.
  - *Done when:* a fresh database can be built from migrations alone.
- [x] **0.4** Add `NOTES.md` session 1 entry and commit the docs bundle.
- [x] **0.5** Set up a `scripts/check.sh` that runs build, typecheck and lint for every workspace. Wire it into CI.
  - *Done when:* `./scripts/check.sh` exits 0.

## Phase 1 — Data model: the work-item spine

Read `docs/02-data-model.md` in full first.

- [x] **1.1** Migration: `clients`, `year_contexts`. Move assessment year off proceedings and onto `year_contexts`.
- [x] **1.2** Migration: `type_registry` plus seed rows for proceeding types, communication types, form types, demand reason codes.
  - *Done when:* adding a new proceeding type requires only an INSERT.
- [x] **1.3** Migration: `proceedings` with `section_2025`, `section_1961`, `limitation_date`, `authority`, `source_panel`, `created_mode`, `status`, `verified_flag`, `gap_flags`.
- [x] **1.4** Migration: `communications` (direction inbound) and `responses` (direction outbound, nullable `in_reply_to`, `response_mode`).
- [x] **1.5** Migration: `adjournment_requests`.
- [x] **1.6** Migration: `documents` — one polymorphic store, `doc_kind`, `parent_type`, `parent_id`, `file_hash`, `source_url`, `fetched_at`, `page_count`, `verified_flag`.
- [x] **1.7** Migration: `ingestion_runs` — `run_at`, `panel_swept`, `records_found`, `gaps`, `operator`, `status`.
- [x] **1.8** Backfill existing notice rows into the new shape. No data loss.
  - *Done when:* row counts before and after reconcile, and a spot check of ten notices matches.
- [x] **1.9** Update all read paths to the new schema. Delete the old tables in a separate migration only after the app runs green.

## Phase 2 — Known bugs and the status state machine

Read `docs/15-known-bugs.md`.

- [x] **2.1** Replace the open/closed boolean with the status state machine from `docs/02-data-model.md`.
- [x] **2.2** Implement the action matrix. Closed and submitted items keep View and Save; only Draft is withheld.
  - *Done when:* a closed proceeding shows View and Save, and no Draft button.
- [x] **2.3** Fix negative due dates. Store dates as date-only, compute in IST, render sign-aware strings.
  - *Done when:* no view can ever render a raw negative number of days.
- [x] **2.4** Add a date-parsing test fixture with a day-of-month above 12 to catch DD/MM versus MM/DD inversion.
- [x] **2.5** Status must win over dates: a closed item never renders as overdue.
- [x] **2.6** Render `NULL` due dates as "not stated" everywhere, never as a blank cell or an epoch date.

## Phase 3 — Clients and credentials

- [x] **3.1** Client registry screen per `docs/09-ui-spec.md`.
- [x] **3.2** Add-client form. GSTIN input derives PAN from characters 3 to 12 and state from characters 1 to 2. Both stay editable.
- [x] **3.3** Credential handling per `docs/07-security.md`. Passwords go to the OS keychain, never the database, never a log.
  - *Done when:* grepping the repo and the database file for a test password returns nothing.
- [x] **3.4** `clients.portal_login_ref` — a client may be reachable through an AR login rather than its own credentials.
- [x] **3.5** Client import from CSV, with a dry-run preview and a per-row error list.
- [x] **3.6** Client detail view: year contexts down the side, modules across.

## Phase 4 — Ingestion service, e-Proceedings

Read `docs/05-ingestion.md` and `docs/06-source-interface.md`.

- [x] **4.1** Define the `NoticeSource` trait/interface: `login`, `list_work_items`, `fetch_item`, `health`. Playwright is one implementation.
- [x] **4.2** Job queue in SQLite: one job per client per module, with attempts, backoff, and a resume cursor.
- [x] **4.3** Attended login flow. The queue pauses for captcha and OTP and waits without failing or timing out the job.
- [x] **4.4** Sweep all six panels. Record zero counts explicitly as an `ingestion_runs` row, never skip.
- [x] **4.5** Per-client lock, five minutes, renewable, so no two devices open one taxpayer's session.
- [x] **4.6** Anchored selectors plus a per-field confidence flag. Low confidence sets `verified_flag = false`.
- [x] **4.7** Document-first storage: fetch the PDF, hash it, store it, then write the index row referencing it.
- [x] **4.8** Early-stop delta walk — stop a client after ten consecutive rows whose hash is already stored and unchanged.
- [x] **4.9** Resumability: kill the process mid-run and restart; it must continue from the last completed client, not the beginning.
- [x] **4.10** Ingestion monitor screen: current client, queue position, panel being swept, pause and resume.

## Phase 5 — Modules 2, 3 and 4

- [~] **5.1** Migration and ingestion for `demands`, `demand_responses`, `payments` per `docs/02-data-model.md`.
- [~] **5.2** Migration and ingestion for `returns`, including `supersedes_id` chaining of revised and updated returns.
- [~] **5.3** Migration and ingestion for `filed_forms`, grouped for display by form type from the registry.
- [x] **5.4** Form-and-receipt pair rule: both nodes always exist; an awaited receipt is a pending node, never an absent one.
- [x] **5.5** Per-module sweep cadence, configurable, defaults in `QUESTIONS.md` Q12.
- [x] **5.6** Unified attention list across all four modules, ranked per `docs/09-ui-spec.md`.

## Phase 6 — Change ledger, snapshots, file transfer

Read `docs/03-sync-and-ledger.md`.

- [x] **6.1** `ledger` table: `device_id`, `seq`, `op`, `entity_type`, `entity_id`, `payload`, `created_at`.
- [x] **6.2** Every write to a synced table appends a ledger entry in the same transaction.
- [x] **6.3** Device cursor as a map of `device_id` to last applied `seq`. Persist it.
- [x] **6.4** Apply logic: idempotent, order-safe within a stream, resumable mid-changeset.
- [x] **6.5** Snapshot builder — compacted state plus the tail, per Q07 cadence.
- [x] **6.6** Encrypted `.draftax` bundle export: manifest, snapshot, ledger tail, content-addressed documents.
- [x] **6.7** Bundle import: merge, never overwrite. Match clients by PAN. Newest scraped-at wins per row. Documents deduplicated by hash.
- [x] **6.8** Export excludes credentials by default; including them requires a second confirmation and a strong passphrase.

## Phase 7 — Relay, devices, roles

Read `docs/04-roles-and-devices.md`.

- [x] **7.1** `relay/` FastAPI service: firm registration, device enrolment, blob put and get by cursor, lease endpoints.
- [x] **7.2** Firm bootstrap: the first user to activate becomes admin, recorded server-side. The server refuses a second admin.
- [x] **7.3** Admin recovery code, shown once at setup, with a confirm-you-saved-it step.
- [x] **7.4** Collector lease: issue, renew, revoke, expire. Only the holder may publish sweep changesets.
- [x] **7.5** Device roster screen. Admin sees the radio control; everyone else sees the same list read-only.
- [x] **7.6** Collector handoff: drain the current client, revoke, reissue, new device catches up before it runs.
- [x] **7.7** Sync button with the three states in `docs/09-ui-spec.md`, including collector-silent detection separate from cursor freshness.
- [x] **7.8** "Changes behind" indicator, broken down by originating device.
- [x] **7.9** On-demand single-client refresh, routed locally for scraper clients.

## Phase 8 — Exports and reports

Read `docs/11-exports.md`.

- [x] **8.1** Excel export, proceedings sheet, exactly the 17 columns in the given order.
- [x] **8.2** Multi-sheet workbook: one tab per module.
- [x] **8.3** Export scope selector: current filtered view, all clients, single client.
- [x] **8.4** Export header block stamping device cursor and collector last-run time.
- [x] **8.5** User-entered columns (`client_code`, `manual_due_date`, `client_file_no`) are editable in-app and sync upward.

## Phase 9 — AI drafting

- [x] **9.1** Draft generation through the server-side proxy. Cache per notice. Never call twice for the same notice.
- [x] **9.2** Suggested due date writes only to `suggested_due_date` with `verified_flag = false`. Promotion requires an explicit user action.
- [x] **9.3** Draft review screen: source notice on one side, draft on the other, edit before use.
- [x] **9.4** No draft button on submitted or closed items.

## Phase 10 — Packaging and release

- [~] **10.1** Windows build via the existing CI workflow. Fix the sidecar target-triple packaging issue if it recurs.
- [x] **10.2** First-run wizard: firm setup, admin creation, recovery code, collector nomination.
- [x] **10.3** Settings screen: sweep cadence, worker count, data folder, about.
- [x] **10.4** Write `docs/USER-GUIDE.md` in plain language, no jargon.
- [x] **10.5** Final pass: update `TASKS.md`, `NOTES.md`, `QUESTIONS.md`, `DECISIONS.md`.

---

## Phase 11 — Finish the partial work

Carried over from phases 5 and 10, marked `[~]`.

- [~] **11.1** Complete `demands`, `demand_responses`, `payments` ingestion (was 5.1). Payments parent is `year_context_id` with nullable links to `demand_response_id` and `proceeding_id` and a `purpose` enum (Q03).
  - *Done when:* a demand with a challan round-trips from portal to Excel.
- [~] **11.2** Complete `returns` ingestion including `supersedes_id` chaining (was 5.2).
  - *Done when:* an original plus a revised return render as one thread, not two rows.
- [~] **11.3** Complete `filed_forms` ingestion, grouped by form type from the registry (was 5.3).
- [~] **11.4** Windows build green in CI (was 10.1). Ship unsigned (Q24). Record in `NOTES.md` that SmartScreen warnings are expected and accepted for now.

## Phase 12 — Apply the answered questions

Read the updated `QUESTIONS.md` first. Each task below corresponds to an answer that differs from the default that was built.

- [x] **12.1** (Q04) Remove the web application. **Do not touch `relay/`** — it is a separate service that happens to also use FastAPI. Before deleting `app/`, diff it against `sidecar/` and `src-tauri/` and confirm nothing unique remains: original Playwright selectors, ERI crypto work, parser fixtures. Move anything unique first.
  - *Done when:* `app/` is gone, `./scripts/check.sh` exits 0, the desktop app still starts, and `relay/` still runs.
- [x] **12.2** (Q21) Rename to **Litigation Command Center**: `productName` in `tauri.conf.json`, window title, frontend constant, export header, installer filename. Change the bundle extension `.draftax` to `.lcc` including the importer's accepted extensions.
- [x] **12.3** (Q21) Fix the bundle identifier typo `in.llc.app` → `in.lcc.app`. Do this before any installer ships. Pick "Center" or "Centre" and apply it in every string.
- [x] **12.4** (Q09) Add a scheduler. An unattended run starts at a configured time, works the queue by itself, and only pauses if a login challenge actually appears. Keep the entire attended flow as the fallback path — do not delete it.
  - *Done when:* a scheduled run completes end to end with nobody present, and a forced challenge pauses it rather than failing it.
- [x] **12.5** (Q08) Move ingestion concurrency to a single config constant, default 1. No other code should assume sequentiality. Document in `NOTES.md` the two tests that would justify raising it.
- [x] **12.6** (Q14) Manual due date may override a portal date. Both are stored and both are displayed, clearly labelled. The manual date drives the Attention ranking and the overdue calculation; export column 13 still carries the portal date. A promoted AI suggestion writes `manual_due_date`, never `due_date`.
  - *Done when:* a proceeding with both dates shows both, and the worklist sorts on the manual one.
- [x] **12.7** (Q01) Remove `Created Mode` from the Excel export. Sheet is now 16 columns. Keep `proceedings.created_mode` in the database. Check nothing downstream reads the sheet by column position before shipping.
- [x] **12.8** (Q22) Stop parsing the proceeding card's status-stepper date. Leave `initiated_on` and `closure_date` nullable and unpopulated. `Issued On` in the export now comes from the communication's `issued_on`; with no communication the cell is blank and gap-flagged.
- [x] **12.9** (Q16) Best-effort remote wipe. A removed device, on next relay contact, pushes any pending ledger entries, then deletes the local database, document store and keychain entry, then shows a plain "this device was removed" screen. The admin confirmation dialog must state plainly that this only works if the device comes online and the app is opened.
- [x] **12.10** (Q17) Collector-silent alerting. Banner on every device plus an email to every user after one missed scheduled run. Debounce to at most one email per day, and send a recovery email when the collector returns. Note in `docs/07-security.md` that staff email addresses now live on the relay.
- [ ] **12.11** (Q13) Move the offline-litigation scope note out of `QUESTIONS.md` into Phase 13 below so it is not lost.
- [ ] **12.12** Update `docs/` to match every change above, then update `DECISIONS.md` with one entry per reversal (D-002 in particular is now superseded by Q09).

## Phase 13 — Offline litigation (deferred, do not start)

Placeholder only. Q13 answered "later phase". Do not begin this without an explicit instruction.

- [ ] **13.1** Hearing diary: hearing dates, adjournments sought and granted, outcomes.
- [ ] **13.2** Counsel notes and briefs against a proceeding.
- [ ] **13.3** Paper filings with no portal source, manually recorded.
- [ ] **13.4** These are firm-authored records: they sync two-way and never come from ingestion.
