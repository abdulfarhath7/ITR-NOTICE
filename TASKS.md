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
- [x] **12.11** (Q13) Move the offline-litigation scope note out of `QUESTIONS.md` into Phase 13 below so it is not lost.
- [x] **12.12** Update `docs/` to match every change above, then update `DECISIONS.md` with one entry per reversal (D-002 in particular is now superseded by Q09).

## Phase 14 — Thread flow redesign

Spec: `docs/thread-flow-context.md`. Ahead of Phase 13, which stays deferred.

- [x] **14.1** Replace the flat proceeding thread with the two-lane flow: pairing in `src/lib/thread-pairing.ts` (six vitest cases), `ThreadFlow` in `src/ui/thread-flow.tsx`, `.thread-flow*` CSS in `base.css`, mini-map, repeat folding, adjournment branch and merge, countdown ring.
  - *Done when:* typecheck, tests and build pass; no horizontal scroll at 1100px with the harness mock; text-hidden screenshot reads by shape and colour. All met. Defaults in Q25–Q29.
- [x] **14.2** (Q28) An adjourned notice whose reissue has arrived is muted with no slot; the reissue carries the due state. With no reissue yet, the sought date is the deadline: warning until it, danger after. The card keeps the portal's stated due date; the slot says "Adjourned to …". Two vitest cases.
- [ ] **14.3** (Q29) Add `"lint": "eslint src --ext .ts,.tsx"` with a minimal ESLint config. Not urgent.

## Phase 13 — Offline litigation (deferred, do not start)

Placeholder only. Q13 answered "later phase". Do not begin this without an explicit instruction.

- [ ] **13.1** Hearing diary: hearing dates, adjournments sought and granted, outcomes.
- [ ] **13.2** Counsel notes and briefs against a proceeding.
- [ ] **13.3** Paper filings with no portal source, manually recorded.
- [ ] **13.4** These are firm-authored records: they sync two-way and never come from ingestion.

---

# Build 2 — Dashboard v2, Updates, Calendar, Client 360

Specification: `docs/16-dashboard-v2.md`. Read it in full before Phase 14.

Same rules as Build 1: work top to bottom, one milestone at a time, never
stop to ask, never test beyond what a task's *Done when* names (the user
tests everything after the whole build), commit after each task, file
unknowns in `QUESTIONS.md` and continue. Phase 22 is reserved for the
user's answers and stays empty until they are given.

Each milestone ends with the app building and starting. Do not begin the
next milestone with a broken tree.

## Phase 14 — Foundations (milestone 1)

- [x] **14.1** Migration `00nn_work_item_meta.sql` per §2.2. Rust commands `get_work_item_meta`, `set_work_item_meta`; ledger entity type `work_item_meta`; `list_work_items` LEFT JOINs and returns `assignee`, `has_note`. Add the fields to `WorkItemRow` and `api.ts`.
  - *Done when:* setting an assignee from a Tauri command round-trips through the ledger and shows on the row.
- [x] **14.2** `issued_on` on `list_work_items` per §2.1, added to `WorkItemRow`.
  - *Done when:* a proceeding with two inbound communications reports the later `issued_on`.
- [x] **14.3** Migration: `drafts.reviewed_at TEXT NULL`. Command to set/clear it. Clear it in the regenerate path.
- [x] **14.4** `ui_scale` in `Settings` (§2.4) with clamp on read. Apply on boot in `main.tsx`. Audit `styles/base.css` and `styles/tokens.css`: text sizes, line heights, row heights, paddings and gaps that should scale move to `rem`; borders, radii, icon strokes and shadows stay in `px`. Record every value you changed in `NOTES.md` in one table.
  - *Done when:* setting `ui_scale` to 125 in `settings.json` visibly scales the whole app with no clipped controls on a 1366×768 window.
- [x] **14.5** `lib/persisted-filters.ts`: read/write one JSON object per screen in `localStorage` (`lcc.filters.<screen>`), following `lib/theme.ts`. Wire the Attention screen's existing four selects to it. Search text is never persisted.
- [x] **14.6** `lib/buckets.ts`: pure functions `issuedBucket(row, today)` and `dueBucket(row, today)` returning a bucket id or `null`, plus `countBuckets(rows, today)`. Predicates from §1.5. `lib/section-tone.ts`: the section→tone map from §1.6.
  - *Done when:* the functions are pure, take `today` as a parameter, and never read the clock themselves.
- [x] **14.7** `NOTES.md` session entry for milestone 1. Commit.

## Phase 15 — Attention screen v2 (milestone 2)

- [x] **15.1** Sync line under the page head (§1.1). Add a "failed" filter to the Ingestion screen if it lacks one; "Retry" navigates there.
- [x] **15.2** Needs-action strip (§1.2). Tiles filter the list; clicking a tile clears bucket selection. Remove the old rank-count row from the UI only; keep `rankRows` and `RANK_LABEL` for sorting and the detail screen.
- [x] **15.3** Owner select and search input in the filter bar (§1.3). Owner names from `work_item_meta` distinct values plus the local user.
- [x] **15.4** Active chips row with per-chip × and "Clear all" (§1.4).
- [x] **15.5** Issued and Due lanes (§1.5) in the 3fr/5fr grid, including the fifth Due tile "Calendar → Open" that navigates to the Calendar route (the route can be a stub until Phase 18). Counts computed after filter bar, before tile/bucket selection. One active bucket per lane. Stack under 900px.
- [x] **15.5a** Views row (§1.6): All · saved views · + Save view; `lib/saved-views.ts` on `localStorage`; save dialog, rename, delete; active tab underline.
- [x] **15.6** List card and additions (§1.7): card chrome, count/sort line, six columns in the stated order, section pill with tone, owner avatar with inline assign, note icon with tooltip, hover actions View / Draft / ✦ Date / Assign, relative due suffix. Row height must not change when hover actions appear.
- [x] **15.7** Bucket-aware sort (§1.7 last paragraph). Reset pagination (`limit`) when tile or bucket changes, as the existing effect does for filters.
- [x] **15.8** Empty states: no open items at all; filters match nothing (with "Clear all"); a selected bucket is empty. Copy per `09-ui-spec.md` "Empty and error states".
- [x] **15.9** Update `docs/09-ui-spec.md` screen 1 to describe the new layout. `NOTES.md` entry. Commit.

## Phase 16 — Settings: text size (milestone 3)

- [ ] **16.1** Stepper control in `ui/stepper.tsx` (A− · five dots · A+ · %) with the live preview line under it. Row in `settings/general.tsx` (§3). Persists immediately via `write_settings`, no save bar.
- [ ] **16.2** Keyboard shortcuts Ctrl/Cmd `+` `−` `0` registered once in the shell; ignored when focus is inside `input`, `textarea`, `select` or a `contenteditable`. Toast "Text size 112%" on change.
- [ ] **16.3** Verify the command palette (⌘K) and every dialog still fit at 125%; fix any that overflow by using `rem` and `max-height: 90vh`. `NOTES.md` entry. Commit.

## Phase 17 — Updates screen (milestone 4)

- [ ] **17.1** Rust command `list_updates(since: Option<String>) -> Vec<UpdateEntry>`: reads the ledger and `ingestion_runs`, computes `since` per §4.1 when not supplied, classifies per §4.2 by comparing each entry's payload with the previous entry for the same entity. Payloads are JSON; do the diff in Rust, return typed entries. PII in `reason` fields is masked with `mask.rs`.
  - *Done when:* a fixture database with two runs returns one entry per §4.2 rule.
- [ ] **17.2** Route `updates`, nav entry after Attention, screen per §4.3. Grouped cards, count pills, danger border on Sync failed, "Mark all seen" writing `lcc.updates.seen_until`, seen entries collapsed under "Seen earlier".
- [ ] **17.3** Row actions: View / Draft / ✦ Date / Open / Retry / Fix, each reusing the existing navigation or command. `Fix` opens the client's credentials form.
- [ ] **17.4** Export button on the screen: one sheet per group, via the export module (§8 rules apply once Phase 21 lands; until then use the current header style).
- [ ] **17.5** Unread badge: the sidebar "Updates" label shows a small count of entries newer than the seen watermark. Recomputed on ingestion events (`onIngestion`) and on screen open. `NOTES.md` entry. Commit.

## Phase 18 — Calendar screen (milestone 5)

- [ ] **18.1** `lib/calendar.ts`: pure month-grid builder (Monday-first, IST, leading/trailing days flagged) and `groupByDay(rows, field, today)`.
- [ ] **18.2** Route `calendar`, nav entry after Updates, screen per §5: month grid, day count pills with tone, `‹ Today ›`, `Due`/`Issued` toggle, selected-day list with View on hover, "n without a due date →" link.
- [ ] **18.3** Read client and module filters from the persisted Attention filter object; show as chips only. Changing them here writes back to the same object.
- [ ] **18.4** Keyboard: arrow keys move the selected day, `t` jumps to today, `Enter` on a day focuses its list. `NOTES.md` entry. Commit.

## Phase 19 — Work item detail: thread, owner, notes (milestone 6)

- [ ] **19.1** Thread layout for communications and responses (§6), newest first, reusing the existing document list per entry.
- [ ] **19.2** Owner row in the detail header with the shared owner select (extract the select into `ui/owner-select.tsx` and reuse it in the list from 15.6).
- [ ] **19.3** Notes section: textarea, save on blur via `set_work_item_meta`, "Saved" toast, loads from `get_work_item_meta` on open.
- [ ] **19.4** "Mark reviewed" in the draft drawer; clears on regenerate; the Attention strip tile updates on return. `NOTES.md` entry. Commit.

## Phase 20 — Client 360 (milestone 7)

- [ ] **20.1** Per-client sync enable: if no flag exists, migration `clients.sync_enabled INTEGER NOT NULL DEFAULT 1`; ingestion queue and scheduler skip disabled clients; `Sync now` enqueues one client.
- [ ] **20.2** Migration `clients.note TEXT`; command to read/write it through the ledger.
- [ ] **20.3** `client-detail.tsx` restructure per §7: header with avatar, identifiers (masked), sync toggle, Sync now; five summary tiles; tabs Profile · Returns · Forms · Demands · e-Proceedings · Notes; default tab e-Proceedings. Tabs reuse the module-items list filtered to the client — do not fork the list component.
- [ ] **20.4** Profile tab is the client form in read mode with an Edit button that swaps to the existing edit form in place. `NOTES.md` entry. Commit.

## Phase 21 — Export polish and docs (milestone 8)

- [ ] **21.1** `export.rs` per §8: timestamped filename, bold filled frozen header with autofilter, fitted column widths, `Owner` and `Note` appended after the existing 16 columns, provenance block lists active filters.
- [ ] **21.2** Every list screen's Export exports the filtered, visible set (Attention, module-items, Updates, Calendar day list).
- [ ] **21.3** Update `docs/09-ui-spec.md` (screens 1, 3, 4, and new 8, 9), `docs/08-api-contract.md` (new commands), `docs/02-data-model.md` (new tables and columns), `docs/11-exports.md` (new columns, filename). Update `docs/USER-GUIDE.md` with one short section per new screen.
- [ ] **21.4** `DECISIONS.md`: one entry per non-obvious choice made in Phases 14–21, each linked to its Qnn where one was filed.
- [ ] **21.5** Final `NOTES.md` entry: what was built, what was skipped with a `TODO(blocked)`, and a one-paragraph "how to test this build" pointer list for the user. Run `./scripts/check.sh`; it must exit 0. Commit.

## Phase 22 — Apply the answered questions (do not start until answers exist)

Placeholder. When `QUESTIONS.md` has `Answer:` lines filled for Q30 onward,
add one task here per answer that differs from the default used, in the
same style as Phase 12, then work them top to bottom. Every task must name
the Qnn it applies and the files it touches. Do not begin any task in this
phase while its question is still `Resolved: no`.
