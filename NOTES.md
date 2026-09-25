# NOTES.md — worklog

Append as you go. This is where the next session picks up your thread.

## How to use
- One entry per work session, newest at the bottom.
- Record errors you hit and how you resolved them.
- Anything unresolved gets a `BLOCKED:` line and a `TODO(blocked):` comment
  at the call site in code.
- Anything secret found already committed goes under `ROTATE IMMEDIATELY`
  by description only — never paste the value.

---

## ROTATE IMMEDIATELY
- **A real PAN and assessee name were committed in `test_app.py`** (the legacy
  web tool's test file), present in history from the first commits through
  `74c3dc5`. The file is removed from the tree in the Phase 0 commit that
  adds `scripts/secret-scan.sh`. It is still in git history; purging it needs
  a history rewrite and a force push, which is the human's call. Not a
  credential, so nothing to rotate — but it is PII in a repo.

## BLOCKED
- **ERI engine.** `EriSource` compiles and reports NotConfigured. Live work
  needs the ITD UAT URL list, the `SERVICE_NAME` string and the real client
  id / secret header names (docs/06). `TODO(blocked)` in
  `src-tauri/src/ingest/eri_source.rs`.
- **Captcha markup.** No live capture shows a captcha; the selectors in
  `sidecar/ingest/session.py` are broad guesses (Q23). `TODO(blocked)` there.
- **Demands, returns and forms parsers.** No DOM capture of "Response to
  Outstanding Demand", "View Filed Returns" or "View Filed Forms" exists, and
  docs/05 forbids parsers written from screenshots. `sidecar/ingest/modules.py`
  navigates by menu text and maps whatever labels the portal renders through
  a label table, marking every field low-confidence. To unblock: capture
  outerHTML + HAR of the three lists from a live session, scrub, commit under
  `sidecar/tests/fixtures/`, pin the label tables with tests.
  `TODO(blocked)` at the top of that file.

## Sessions

### Session 1 — 2026-09-12
- Started at: Phase 0, task 0.1, on commit `ce3c7d3` plus the uncommitted
  spec bundle (committed first as `a724978`).
- Environment notes: Linux (Wayland), node 22, npm 9, cargo 1.98, python 3.12
  in `.venv` (ruff + mypy + fastapi + anthropic added), no `sqlite3` CLI
  (use python). `npm run tauri dev` opens a window; Rust warm build 17 s.
  `data/itr.db` holds real client data from the web tool (28 proceedings,
  70 notices, every one with a PDF) — the backfill fixture for task 1.8.
- Previous-generation docs, NOTES and QUESTIONS moved to `docs/legacy/`
  (D-006). Their open questions (updater, code signing, NSIS mode, pinning
  the sidecar's Python deps) are still open and matter for Phase 10.
- `.npmrc` (a machine-specific npm prefix) was about to be committed;
  now gitignored.
- Errors and resolutions:
  - `ruff` picked up a user-level config with ~30 rules against the legacy
    tree. Added `ruff.toml` with an explicit rule set and the frozen legacy
    trees (`app/`, `sidecar/app/`) excluded — they must stay byte-identical.
  - `mypy --strict` failed on `proxy/main.py` and `sidecar/notice_scraper.py`
    (missing annotations, untyped `dict` to the Anthropic SDK). Annotated the
    wrapper; the two SDK calls carry `# type: ignore[call-overload]` because
    the SDK's TypedDict params would need every prompt dict retyped, which is
    outside Phase 0.
  - `scripts/secret-scan.sh` flagged `test_app.py` (real PAN) and a false
    positive in `release.yml` (`$password = ConvertTo-SecureString`). The
    regex now requires a digit in the suspected literal; `test_app.py` is
    removed (see ROTATE IMMEDIATELY).
- Ended at: Phase 0 complete.

### Session 1 (continued) — Phases 1–4
- Phase 1: spine migrations 0002–0010, `intake::absorb` as the one mapping
  from portal cards to rows, backfill reconciled 28/70/70/1 against a copy of
  the real archive. The local desktop archive (`~/.local/share/in.llc.app/`)
  was backed up to `backup-2026-09-12/` before the app first opened it on
  the new schema.
- Phase 2: status machine + action matrix on both sides; every due cell goes
  through `describeDue()`; vitest covers docs/12's date cases.
- Phase 3: the frontend was rebuilt on docs/10 (the old "command centre" CSS
  and single-screen dashboard are gone). Router, query layer, six screens.
- Phase 4: v2 sidecar (`sidecar/draftax_sidecar.py`, `sidecar/ingest/`),
  anchored parsers written from the DOM captures in `data/debug/recon3`
  (scrubbed fixtures under `sidecar/tests/fixtures/`), `NoticeSource` trait,
  queue + locks (migration 0011), runner with the ten-row streak, the
  monitor screen. The legacy v1 sidecar (`notice_scraper.py`,
  `src-tauri/src/scraper.rs`) is removed; `app/portal/*` stays frozen and is
  imported for its verified selectors and login mechanics.
- Errors and resolutions:
  - `Date.parse` on `17-Aug-2026` and a raw `days` cell in the old report
    were the two halves of bug 1; both paths are gone.
  - The legacy `_download()` clicked the page's *first* "Notice/Letter pdf"
    button, not the current card's, so a proceeding with several notices
    would have stored the first notice's PDF under every reference id. The
    v2 walk scopes the click to the card (`_download_from_card`). Rows
    absorbed by the old tool are not re-verified here; a fresh sweep fetches
    a document only where none is stored, so re-fetching would need those
    document rows removed first. Flagged for the human.
  - The DOM captures show only two tabs on this account (Self, Of Other
    PAN/TAN); the AR tab is recorded as a missing panel with a zero-count
    row, per docs/05.
  - `tauri::test::mock_app` needs the runner to be generic over the runtime;
    `Runner<R: tauri::Runtime>`.
  - mypy strict refuses calls into the untyped frozen tree; `[mypy-ingest.*]
    disallow_untyped_calls = False`.
- Unverified against the live portal (no credentials here, and an
  autonomous run must not log into a real taxpayer account): the v2 walk end
  to end, captcha detection, the stepper-date semantics (Q22). The frozen
  sidecar answers the protocol handshake; the runner is exercised by tests
  with a mock source.
- Phase 5: migration 0013 (demands, demand_responses, payments, returns,
  filed_forms), `intake_modules.rs` with the pair rule and supersedes
  chaining (tests), the four-module union in `list_work_items`, detail
  screens, cadence in `local_kv` (Q12 defaults) with "Sweep what is due" /
  "Sweep everything now". The module walkers in the sidecar are blocked on
  captures (see BLOCKED); the pipeline from header to row is complete and
  tested with mock headers.
- Phase 6: ledger (migrations 0014–0016), merge-never-overwrite with
  natural keys and the smaller-id rule (D-017), JSON snapshots (D-016),
  the `.draftax` bundle (AES-256-GCM over Argon2id, Ed25519 signature).
  docs/12's ledger and snapshot cases are Rust tests.
- Phase 7: `relay/` (FastAPI + SQLite, signed requests, the four
  server-enforced invariants as pytest cases), `src-tauri/src/relay.rs`
  (signed client, firm-key sealing, opaque client keys for locks),
  `sync.rs` (push contiguous runs by kind, pull by cursor map, two facts
  kept apart), lease claim/renew/handoff in the runner, roster screen with
  the admin's radio control, firm setup / join / recover dialogs, the
  three-state Sync button in the sidebar. A live round trip against a local
  uvicorn (`RELAY_URL=... cargo test relay_round_trip -- --ignored`) passes:
  register, invite, enrol, push, pull, nominate, lease, lock.
- Errors and resolutions:
  - Tauri commands must return `Send` futures; holding the archive
    `MutexGuard` across a network await made three enrolment commands
    non-Send. Split into read-id / network / store steps.
  - ruff's B008 objects to `Depends(caller)` in every signature; one
    module-level `CALLER = Depends(caller)` instead.
  - `pkill -f "uvicorn relay.main:app"` matched the shell running it and
    killed the whole command; bracket a character in the pattern.
- Phase 8: `src-tauri/src/export.rs` with `rust_xlsxwriter`: four sheets,
  the 17 proceedings columns in order, real Excel dates (`dd-mmm-yyyy`),
  numeric amounts, text identifiers, blank gaps, the three-row header block
  with IST timestamp, collector last run and this device's cursor. Scope
  selector on Attention (current view, by the visible rows' ids), Clients
  (all) and Client detail (one client), with counts shown before committing.
  8.5's user-entered columns were already app-editable and ledgered, so
  they sync like any other write.
- Phase 9: commands renamed to docs/08 (`create_draft`, `suggest_due_date`,
  `promote_suggested_due_date`). A draft is made once per notice — the
  Regenerate control is gone. A suggestion lands in `suggested_due_date`
  only; Promote copies it into the manual due date (a blank only, Q14) by
  an explicit click, never automatically. The review screen shows the
  notice PDF beside the draft. Draft stays behind the action matrix.
- Phase 10: version 0.2.0 across `tauri.conf.json`, `Cargo.toml`,
  `package.json`; the release workflow names the artefact
  `draftax-windows` and checks `resources/sidecar/draftax_sidecar.exe`.
  **10.1 is not runnable here** (Windows-only job); marked partial. The
  first-run wizard gates on `local_kv.setup_done` (D-024). Settings gained
  the data folder (with Open) and the fixed worker count (D-025).
  `docs/USER-GUIDE.md` and `docs/SMOKE.md` written.
- Ended at: Phase 10 complete except 10.1's CI run. The tree is green
  (`./scripts/check.sh`), 30 Rust tests, 11 vitest cases, 2 parser
  fixtures, 6 relay invariant tests.

### Session 2 — 2026-09-12, applying the answered questions
- Phase 11: the demand-with-challan round trip (card → rows → Demands
  sheet with CIN) and the original-plus-revised return as one thread (list
  shows the head, detail shows the chain) are Rust tests and UI. What is
  still missing for 11.1–11.3 is the same thing as before: DOM captures of
  the three list pages, so the sidecar's label tables can be pinned. The
  pipeline from header to Excel is complete; the parsers are marked
  low-confidence until then. 11.4: the Windows job cannot run from this
  box; it is reviewed, renamed and points at the new sidecar path.
  **SmartScreen warnings on install are expected and accepted for now**
  (Q24: ship unsigned; an OV certificate when a firm installs unattended).
- docs/06 says `eri_crypto.py` and `test_eri_login.py` exist in the repo.
  They do not — `git ls-files | grep -i eri` finds only the stub — so
  there was nothing to move out of `app/` for Q04. If they live outside
  this repository, bring them into `sidecar/eri/` when ERI work resumes.

- Q08 (concurrency): `INGESTION_WORKERS` in `src-tauri/src/ingest/runner.rs`
  is the one constant; the run is a pool of that many workers claiming jobs
  atomically, each with its own sidecar. Two tests would justify raising
  it, both by hand on the live portal: (1) the same client in two browsers
  — does the first session die? (2) two *different* clients in two browsers
  — do both survive? Only (2) matters for throughput. Before raising it,
  also give each job its own challenge slot (today `RunHandle.sidecar` is
  one handle) and make the monitor show one row per worker.

- Phase 12 done except nothing: 12.1–12.12 applied (Q01, Q04, Q08, Q09,
  Q13, Q14, Q16, Q17, Q21, Q22). Reversals recorded as D-026 to D-032;
  D-002 is superseded by D-027, D-012 by D-026. docs/02, 04, 05, 06, 07,
  09, 11, 00 and the user guide updated to match.
- Still open for the human: Q08 (the two live tests), Q11 (count the AR
  panel), Q24 (unsigned release), and the three blocked items.

### For the next session
- Run the Windows release job (tag `v0.2.0`) and fix whatever the frozen
  sidecar does on Windows; the `CREATE_NO_WINDOW` flag and the sidecar
  path search in `portal_source.rs` are the two places to look first.
- The three blocked items above (ERI, captcha markup, module parsers) all
  need something from a live portal session or the ITD.
- Answer `QUESTIONS.md` and re-run with the follow-up prompt in
  `PROMPT.md`.

### Session 3 — 2026-09-13, production pass: efficiency, cleanliness, UI
- Frontend redesigned on the docs/10 tokens with Linear, Vercel and Attio
  as the references: icon navigation with an overdue badge, a Ctrl+K
  command palette, stat tiles that filter the Attention list, rows
  grouped by rank with arrow-key navigation, sortable client columns, and
  Settings rebuilt as one section per concern (D-033). Screenshots were
  taken against a stubbed Tauri bridge (Playwright, scratch only) to check
  every screen in both themes; nothing of that is in the repo.
- Query layer: cache plus stale-while-revalidate plus in-flight dedupe
  (D-034). The first version returned the mutated entry object from
  `getSnapshot`, so `useSyncExternalStore` never re-rendered and every
  screen sat on "Loading"; snapshots are immutable now.
- Rust: the crate-wide dead-code allow is lifted (D-035). Found behind it:
  the per-login session lock was never renewed (task 4.5 says renewable),
  so a client whose sweep ran past five minutes could be opened by a
  second device — a renewal task now runs at half the lock's life.
  `get_notice` loaded every notice to find one. Per-row lookups in the
  export and queue builder use `prepare_cached`.
- Relay: blocking `time.sleep` and SMTP moved off the event loop; blob
  size caps (D-036); `RELAY_DB` and the SMTP variables are documented.
- `relay.db` (a runtime SQLite file with roster rows from local runs) was
  tracked in git. Untracked and ignored; it stays in history. It holds
  device public keys, firm names and optional emails, no secrets.
- `scripts/check.sh` compiled a `sidecar/notice_scraper.py` that no longer
  exists (the step printed "Can't list" and passed anyway); it now
  compiles `sidecar/app` and `sidecar/ingest`.
- The unused `xlsx` npm dependency is gone (export is Rust); the package
  is named `lcc`; the version is stamped from package.json into About.
- Review pass (a second agent over the diff) found one thing: a panic in
  the session would have left the lock-renewal task running. It is a drop
  guard now. The proceeding detail then got its thread in three queries
  instead of three per communication.
- Not done, by choice: `spawn_blocking` around the sink's SQL writes in
  the runner (short, no await held across a lock; a desktop app tolerates
  it).
- Ended at: tree green (`./scripts/check.sh`), 31 Rust tests, 13 vitest
  cases, 9 relay tests. `TASKS.md` unchanged: no phase task was opened or
  closed by this pass; Phase 11's three parsers and 11.4 still wait on
  the same inputs as before.

## Portal cartographer (sidecar/recon)

Read-only crawler that maps portal screens for future automation: per screen it
saves page.html, inventory.json (interactive elements with candidate
selectors, headings, tables, form fields), aria.yaml, shot.png; plus every
XHR exchange and a values-free api-catalog.json. Navigation is menu-click
only (URL changes trip #securityReasonPopup). In-page clicks are limited to
tabs and a "view" allowlist; recon/guard.py DENY extends scraper FORBIDDEN.
Output lives in data/portal-map/ (gitignored: it holds client data).
Not yet run live: needs credentials via ITR_RECON_USER / ITR_RECON_PASSWORD
or --ask. GST mode needs a human to log in (captcha).

### Findings from the first live capture (2026-09-23)

- Filed returns and filed forms never worked: the module walk used the
  e-Proceedings card reader, whose classes do not exist on those pages.
  Fixed with MODULE_CARD_JS; forms are two levels (form type > View All >
  filings). Checked offline against the captured HTML only, not in a sweep.
- Portal cards write dates as "Nov 28, 2023"; dates.rs now reads it.
- Write controls sit on these cards: Withdraw (filed forms) and a
  "submit intimation order request? Yes/No" dialog behind "Download
  Intimation Order" (filed returns). Neither is clicked; the guard refuses
  both.
- Demands: still unverified, the captured account had none.
- TODO(blocked): re-login after ~15 min fails. PortalSession.ensure_alive
  navigates to the login page while logged in and the User ID page's
  Continue stays disabled (Timeout on get_by_role("button", name="Continue")).
  Sweeps longer than ~15 min will hit this. Likely fix: log out or clear
  cookies before re-login; needs a live check.

## Build 2 — Dashboard v2 (docs/16-dashboard-v2.md)

### Milestone 1 — Foundations (2026-09-24)

- Context installed from `files.zip`: `docs/16-dashboard-v2.md`, Build 2
  phases appended to `TASKS.md`, Q30–Q34 in `QUESTIONS.md`, reading-order
  row and rule 9 in `CLAUDE.md`. Phase-number collision with the
  thread-flow Phase 14 filed as Q35; saved views vs §9 as Q36; the missing
  `--radius` token as Q37.
- 14.1 Migration 0017 `work_item_meta` (id `module:item_id`, D-038),
  `repo/meta.rs`, commands `get_work_item_meta`, `set_work_item_meta`,
  `list_assignees`; `list_work_items` LEFT JOINs it and returns
  `assignee`, `has_note`. Rust tests: ledger round trip to a second device,
  and the assignee on the list row.
- 14.2 `issued_on` on every work-item row (proceedings: max inbound
  `communications.issued_on`; demands `raised_on`; returns and forms
  `filed_on`). Rust test with two inbound notices.
- 14.3 Migration 0018 `drafts.reviewed_at`; command `set_draft_reviewed`;
  `db::save_draft` (the generate/regenerate path) clears it (D-039). Rows
  also carry `drafts_to_review` for the strip tile.
- 14.4 `Settings.ui_scale` (serde default 100, clamped to 85/92/100/112/125
  on read and write). `main.tsx` applies the cached value before first
  paint, then the saved one. CSS audit below (D-040). Not checked on a
  1366×768 window in the real app (no display in this session); checked
  in the browser harness at milestone 2.
- 14.5 `lib/persisted-filters.ts` (`lcc.filters.<screen>`); Attention's four
  selects persist.
- 14.6 `lib/buckets.ts` (issued, due and strip-tile predicates, all take
  `today`), `lib/section-tone.ts` (section → tone map, data only).

#### px → rem changes (task 14.4)

Kept in px on purpose: every `border*`, `border-radius`, `box-shadow`,
`outline*`, 1px/2px hairlines, `.switch` geometry (its knob moves by a px
`translateX`), and the thread-flow block except its font sizes (its
positions are computed in JS). Media-query breakpoints stay px.

| File | Line | Selector | Property | Was | Now |
|---|---|---|---|---|---|
| tokens.css | 25 | `(cont.)` | --row-h | `40px` | `2.5rem` |
| tokens.css | 26 | `(cont.)` | --control-h | `32px` | `2rem` |
| base.css | 12 | `(cont.)` | font | `400 13px/20px var(--font-ui)` | `400 0.8125rem/1.25rem var(--font-ui)` |
| base.css | 20 | `h1` | font | `500 20px/28px var(--font-ui)` | `500 1.25rem/1.75rem var(--font-ui)` |
| base.css | 21 | `h2` | font | `500 15px/22px var(--font-ui)` | `500 0.9375rem/1.375rem var(--font-ui)` |
| base.css | 22 | `h3` | font | `500 13px/20px var(--font-ui)` | `500 0.8125rem/1.25rem var(--font-ui)` |
| base.css | 24 | `.meta` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 40 | `(cont.)` | height | `18px` | `1.125rem` |
| base.css | 40 | `(cont.)` | padding | `0 5px` | `0 0.3125rem` |
| base.css | 43 | `(cont.)` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 45 | `.keys` | gap | `4px` | `0.25rem` |
| base.css | 48 | `.shell` | grid-template-columns | `224px 1fr` | `14rem 1fr` |
| base.css | 53 | `(cont.)` | padding | `12px 10px` | `0.75rem 0.625rem` |
| base.css | 54 | `(cont.)` | gap | `8px` | `0.5rem` |
| base.css | 58 | `(cont.)` | gap | `8px` | `0.5rem` |
| base.css | 59 | `(cont.)` | padding | `4px 6px 8px` | `0.25rem 0.375rem 0.5rem` |
| base.css | 63 | `(cont.)` | width | `22px` | `1.375rem` |
| base.css | 63 | `(cont.)` | height | `22px` | `1.375rem` |
| base.css | 66 | `(cont.)` | font | `500 10px var(--font-mono)` | `500 0.625rem var(--font-mono)` |
| base.css | 70 | `(cont.)` | gap | `8px` | `0.5rem` |
| base.css | 71 | `(cont.)` | height | `30px` | `1.875rem` |
| base.css | 71 | `(cont.)` | padding | `0 8px` | `0 0.5rem` |
| base.css | 81 | `(cont.)` | gap | `10px` | `0.625rem` |
| base.css | 82 | `(cont.)` | height | `32px` | `2rem` |
| base.css | 82 | `(cont.)` | padding | `0 8px` | `0 0.5rem` |
| base.css | 91 | `(cont.)` | min-width | `20px` | `1.25rem` |
| base.css | 91 | `(cont.)` | height | `18px` | `1.125rem` |
| base.css | 91 | `(cont.)` | padding | `0 6px` | `0 0.375rem` |
| base.css | 94 | `(cont.)` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 99 | `.nav-foot` | gap | `6px` | `0.375rem` |
| base.css | 100 | `.nav-foot .btn` | font-size | `12px` | `0.75rem` |
| base.css | 100 | `.nav-foot .btn` | height | `30px` | `1.875rem` |
| base.css | 101 | `.nav-sync` | gap | `4px` | `0.25rem` |
| base.css | 103 | `(cont.)` | gap | `6px` | `0.375rem` |
| base.css | 103 | `(cont.)` | padding | `2px 6px` | `2px 0.375rem` |
| base.css | 104 | `(cont.)` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 109 | `.nav-note` | padding-top | `8px` | `0.5rem` |
| base.css | 114 | `(cont.)` | gap | `10px` | `0.625rem` |
| base.css | 115 | `(cont.)` | padding | `14px 24px 12px` | `0.875rem 1.5rem 0.75rem` |
| base.css | 115 | `(cont.)` | min-height | `58px` | `3.625rem` |
| base.css | 120 | `.page-meta` | gap | `8px` | `0.5rem` |
| base.css | 123 | `(cont.)` | gap | `4px` | `0.25rem` |
| base.css | 123 | `(cont.)` | height | `26px` | `1.625rem` |
| base.css | 123 | `(cont.)` | padding | `0 8px 0 4px` | `0 0.5rem 0 0.25rem` |
| base.css | 128 | `.page-body` | padding | `16px 24px 32px` | `1rem 1.5rem 2rem` |
| base.css | 128 | `.page-body` | gap | `16px` | `1rem` |
| base.css | 129 | `.page-body.narrow` | max-width | `760px` | `47.5rem` |
| base.css | 133 | `(cont.)` | padding | `0 12px` | `0 0.75rem` |
| base.css | 137 | `(cont.)` | gap | `6px` | `0.375rem` |
| base.css | 144 | `.btn.danger` | padding | `0 8px` | `0 0.5rem` |
| base.css | 146 | `.btn.small` | height | `26px` | `1.625rem` |
| base.css | 146 | `.btn.small` | padding | `0 8px` | `0 0.5rem` |
| base.css | 146 | `.btn.small` | font-size | `12px` | `0.75rem` |
| base.css | 146 | `.btn.small` | gap | `4px` | `0.25rem` |
| base.css | 148 | `.btn.icon` | width | `26px` | `1.625rem` |
| base.css | 152 | `(cont.)` | padding | `0 10px` | `0 0.625rem` |
| base.css | 159 | `.input.short` | max-width | `220px` | `13.75rem` |
| base.css | 160 | `.textarea` | padding | `8px 10px` | `0.5rem 0.625rem` |
| base.css | 160 | `.textarea` | line-height | `20px` | `1.25rem` |
| base.css | 163 | `.select` | padding-right | `26px` | `1.625rem` |
| base.css | 165 | `(cont.)` | background-position | `calc(100% - 14px) 13px, calc(100% - 9px) 13px` | `calc(100% - 0.875rem) 0.8125rem, calc(100% - 0.5625rem) 0.8125rem` |
| base.css | 167 | `(cont.)` | gap | `8px` | `0.5rem` |
| base.css | 167 | `(cont.)` | padding | `0 10px` | `0 0.625rem` |
| base.css | 167 | `(cont.)` | width | `260px` | `16.25rem` |
| base.css | 175 | `.field` | gap | `4px` | `0.25rem` |
| base.css | 176 | `.field > label` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 177 | `.field .hint` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 178 | `.field .error` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 179 | `.form-grid` | gap | `12px 16px` | `0.75rem 1rem` |
| base.css | 181 | `.check` | gap | `8px` | `0.5rem` |
| base.css | 182 | `.input.cc` | width | `64px` | `4rem` |
| base.css | 185 | `.toolbar` | gap | `8px` | `0.5rem` |
| base.css | 186 | `.filters` | gap | `8px` | `0.5rem` |
| base.css | 191 | `(cont.)` | height | `26px` | `1.625rem` |
| base.css | 191 | `(cont.)` | padding | `0 10px` | `0 0.625rem` |
| base.css | 192 | `(cont.)` | gap | `6px` | `0.375rem` |
| base.css | 203 | `.chips` | gap | `6px` | `0.375rem` |
| base.css | 205 | `(cont.)` | height | `26px` | `1.625rem` |
| base.css | 205 | `(cont.)` | padding | `0 10px` | `0 0.625rem` |
| base.css | 206 | `(cont.)` | font-size | `12px` | `0.75rem` |
| base.css | 214 | `(cont.)` | height | `20px` | `1.25rem` |
| base.css | 214 | `(cont.)` | padding | `0 8px` | `0 0.5rem` |
| base.css | 216 | `(cont.)` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 231 | `.unverified` | font-size | `11px` | `0.6875rem` |
| base.css | 231 | `.unverified` | margin-left | `4px` | `0.25rem` |
| base.css | 235 | `.stats` | gap | `8px` | `0.5rem` |
| base.css | 237 | `(cont.)` | padding | `10px 14px` | `0.625rem 0.875rem` |
| base.css | 243 | `.stat .value` | font | `500 20px/28px var(--font-ui)` | `500 1.25rem/1.75rem var(--font-ui)` |
| base.css | 244 | `.stat .label` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 248 | `.dot` | width | `6px` | `0.375rem` |
| base.css | 248 | `.dot` | height | `6px` | `0.375rem` |
| base.css | 248 | `.dot` | margin-right | `8px` | `0.5rem` |
| base.css | 257 | `(cont.)` | padding | `0 12px` | `0 0.75rem` |
| base.css | 260 | `(cont.)` | font-size | `13px` | `0.8125rem` |
| base.css | 260 | `(cont.)` | line-height | `18px` | `1.125rem` |
| base.css | 266 | `(cont.)` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 269 | `.th-sort` | gap | `4px` | `0.25rem` |
| base.css | 280 | `table.table td .sub` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 283 | `(cont.)` | height | `30px` | `1.875rem` |
| base.css | 283 | `(cont.)` | padding | `0 12px` | `0 0.75rem` |
| base.css | 284 | `(cont.)` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 286 | `table.table tr.group th .count` | margin-left | `8px` | `0.5rem` |
| base.css | 287 | `table.table.compact th, table.table.compact td` | height | `30px` | `1.875rem` |
| base.css | 287 | `table.table.compact th, table.table.compact td` | font-size | `12px` | `0.75rem` |
| base.css | 288 | `.actions` | gap | `6px` | `0.375rem` |
| base.css | 289 | `.table-foot` | gap | `8px` | `0.5rem` |
| base.css | 289 | `.table-foot` | padding | `8px 12px` | `0.5rem 0.75rem` |
| base.css | 293 | `.card .card-head` | gap | `8px` | `0.5rem` |
| base.css | 293 | `.card .card-head` | padding | `12px 16px` | `0.75rem 1rem` |
| base.css | 295 | `.card .card-body` | padding | `16px` | `1rem` |
| base.css | 297 | `.captcha` | max-width | `320px` | `20rem` |
| base.css | 298 | `.stack` | gap | `8px` | `0.5rem` |
| base.css | 300 | `.row` | gap | `8px` | `0.5rem` |
| base.css | 301 | `.grid-2` | gap | `16px` | `1rem` |
| base.css | 302 | `.grid-4` | gap | `16px` | `1rem` |
| base.css | 303 | `.kv` | grid-template-columns | `160px 1fr` | `10rem 1fr` |
| base.css | 303 | `.kv` | gap | `6px 16px` | `0.375rem 1rem` |
| base.css | 304 | `.kv dt` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 306 | `.path` | font | `400 12px/18px var(--font-mono)` | `400 0.75rem/1.125rem var(--font-mono)` |
| base.css | 307 | `.step .card-head` | gap | `12px` | `0.75rem` |
| base.css | 309 | `(cont.)` | width | `22px` | `1.375rem` |
| base.css | 309 | `(cont.)` | height | `22px` | `1.375rem` |
| base.css | 312 | `(cont.)` | font | `500 11px var(--font-ui)` | `500 0.6875rem var(--font-ui)` |
| base.css | 317 | `.empty` | padding | `40px 24px` | `2.5rem 1.5rem` |
| base.css | 317 | `.empty` | gap | `8px` | `0.5rem` |
| base.css | 319 | `.empty p` | max-width | `420px` | `26.25rem` |
| base.css | 320 | `.loading` | padding | `24px` | `1.5rem` |
| base.css | 331 | `(cont.)` | width | `min(680px, calc(100vw - 48px))` | `min(42.5rem, calc(100vw - 3rem))` |
| base.css | 331 | `(cont.)` | max-height | `calc(100vh - 48px)` | `calc(100vh - 3rem)` |
| base.css | 336 | `.dialog.wide` | width | `min(960px, calc(100vw - 48px))` | `min(60rem, calc(100vw - 3rem))` |
| base.css | 337 | `.dialog .dialog-head` | gap | `8px` | `0.5rem` |
| base.css | 337 | `.dialog .dialog-head` | padding | `14px 16px` | `0.875rem 1rem` |
| base.css | 339 | `.dialog .dialog-body` | padding | `16px` | `1rem` |
| base.css | 339 | `.dialog .dialog-body` | gap | `12px` | `0.75rem` |
| base.css | 340 | `.dialog .dialog-foot` | gap | `8px` | `0.5rem` |
| base.css | 340 | `.dialog .dialog-foot` | padding | `12px 16px` | `0.75rem 1rem` |
| base.css | 343 | `(cont.)` | width | `min(560px, 100vw)` | `min(35rem, 100vw)` |
| base.css | 354 | `(cont.)` | width | `min(640px, calc(100vw - 48px))` | `min(40rem, calc(100vw - 3rem))` |
| base.css | 359 | `.palette-input` | gap | `10px` | `0.625rem` |
| base.css | 359 | `.palette-input` | padding | `0 14px` | `0 0.875rem` |
| base.css | 359 | `.palette-input` | height | `48px` | `3rem` |
| base.css | 360 | `.palette-input input` | font-size | `14px` | `0.875rem` |
| base.css | 362 | `.palette-list` | padding | `6px` | `0.375rem` |
| base.css | 363 | `.palette-group` | padding | `8px 10px 4px` | `0.5rem 0.625rem 0.25rem` |
| base.css | 363 | `.palette-group` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 365 | `(cont.)` | gap | `10px` | `0.625rem` |
| base.css | 365 | `(cont.)` | height | `34px` | `2.125rem` |
| base.css | 365 | `(cont.)` | padding | `0 10px` | `0 0.625rem` |
| base.css | 370 | `.palette-item .hint` | font-size | `11px` | `0.6875rem` |
| base.css | 371 | `.palette-empty` | padding | `24px` | `1.5rem` |
| base.css | 373 | `.toasts` | gap | `8px` | `0.5rem` |
| base.css | 375 | `(cont.)` | padding | `10px 12px` | `0.625rem 0.75rem` |
| base.css | 377 | `(cont.)` | gap | `12px` | `0.75rem` |
| base.css | 377 | `(cont.)` | max-width | `420px` | `26.25rem` |
| base.css | 386 | `(cont.)` | padding | `10px 14px` | `0.625rem 0.875rem` |
| base.css | 388 | `(cont.)` | gap | `10px` | `0.625rem` |
| base.css | 396 | `.settings` | grid-template-columns | `220px minmax(0, 720px)` | `13.75rem minmax(0, 45rem)` |
| base.css | 396 | `.settings` | gap | `32px` | `2rem` |
| base.css | 397 | `.settings-nav` | top | `74px` | `4.625rem` |
| base.css | 399 | `(cont.)` | gap | `10px` | `0.625rem` |
| base.css | 399 | `(cont.)` | padding | `6px 10px` | `0.375rem 0.625rem` |
| base.css | 399 | `(cont.)` | min-height | `44px` | `2.75rem` |
| base.css | 406 | `.settings-nav .hint` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 407 | `.settings-body` | gap | `24px` | `1.5rem` |
| base.css | 409 | `.settings-section > header` | padding | `14px 16px` | `0.875rem 1rem` |
| base.css | 409 | `.settings-section > header` | gap | `4px` | `0.25rem` |
| base.css | 410 | `.settings-section > footer` | padding | `10px 16px` | `0.625rem 1rem` |
| base.css | 410 | `.settings-section > footer` | gap | `8px` | `0.5rem` |
| base.css | 412 | `.settings-row` | gap | `16px` | `1rem` |
| base.css | 412 | `.settings-row` | padding | `12px 16px` | `0.75rem 1rem` |
| base.css | 412 | `.settings-row` | min-height | `52px` | `3.25rem` |
| base.css | 414 | `.settings-row.stacked` | gap | `8px` | `0.5rem` |
| base.css | 416 | `.settings-label .hint` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 417 | `.settings-control` | gap | `8px` | `0.5rem` |
| base.css | 421 | `.settings-control .select` | min-width | `160px` | `10rem` |
| base.css | 422 | `.save-bar` | gap | `8px` | `0.5rem` |
| base.css | 422 | `.save-bar` | font-size | `12px` | `0.75rem` |
| base.css | 425 | `.log` | font | `400 12px/18px var(--font-mono)` | `400 0.75rem/1.125rem var(--font-mono)` |
| base.css | 426 | `(cont.)` | padding | `8px 10px` | `0.5rem 0.625rem` |
| base.css | 426 | `(cont.)` | max-height | `260px` | `16.25rem` |
| base.css | 434 | `.tabs button` | height | `32px` | `2rem` |
| base.css | 434 | `.tabs button` | padding | `0 12px` | `0 0.75rem` |
| base.css | 437 | `.side-list button` | height | `32px` | `2rem` |
| base.css | 437 | `.side-list button` | padding | `0 10px` | `0 0.625rem` |
| base.css | 437 | `.side-list button` | gap | `8px` | `0.5rem` |
| base.css | 441 | `.split` | grid-template-columns | `180px 1fr` | `11.25rem 1fr` |
| base.css | 441 | `.split` | gap | `16px` | `1rem` |
| base.css | 461 | `.tf-lane-heads` | font | `400 11px/16px var(--font-ui)` | `400 0.6875rem/1rem var(--font-ui)` |
| base.css | 504 | `.tf-chip` | font-size | `12px` | `0.75rem` |
| base.css | 518 | `.code-big` | font | `400 18px/28px var(--font-mono)` | `400 1.125rem/1.75rem var(--font-mono)` |
| base.css | 519 | `.list` | padding-left | `18px` | `1.125rem` |
| base.css | 524 | `.settings` | gap | `16px` | `1rem` |
| base.css | 527 | `.settings-nav a` | min-height | `32px` | `2rem` |

### Milestone 2 — Attention screen v2 (2026-09-24)

- 15.1 `get_sync_line` (Rust, `repo/runs.rs`): the window is the sweep that
  holds the newest run; counts distinct clients and failed/parked runs in
  it. Ingestion screen gained an All / Failed switch on Sweep history and
  a route `#/ingestion/failed` that preselects it.
- 15.2–15.8 `screens/attention.tsx` rewritten per docs/16 §1: strip, owner
  select and search, chips, lanes (with the Calendar tile; the Calendar
  route is a stub until Phase 18), views row (`lib/saved-views.ts`), list
  card with six columns, section tone pill, owner avatar with inline
  assign (`ui/owner-select.tsx`, extracted now rather than in 19.2), note
  icon, hover/focus actions, bucket-aware sort, three empty states.
  `rankRows`/`RANK_LABEL` kept: they order the list and label the group
  headers shown in the default order.
- Draft and ✦ Date on a list row act on the proceeding's newest open
  communication (the detail screen's buttons act on the one clicked).
- The note icon's tooltip says the item has a note; the row carries only
  `has_note`, not the text, so the 120-character preview named in §1.7 is
  not shown. Filed as Q38.
- Search does not get a chip: §1.4's chip list does not include it. Clear
  all still empties it; Escape in the box empties it too.
- Checked in a browser harness (Vite with the Tauri core mocked, kept out
  of the repo) at 1366×768: no horizontal overflow at 100% or 125%, row
  height stays 40px when hover actions appear, bucket click filters and
  persists, tile click clears the bucket.

### Milestone 3 — Settings: text size (2026-09-24)

- 16.1 `ui/stepper.tsx` (A− · five dots · A+ · %) in Settings › General
  with the live preview line (sample PAN in the masked form the secret
  scan allows). `hooks/use-text-size.ts` applies at once and persists
  through `save_settings`, writes serialised so key repeats land in order.
- 16.2 Ctrl/Cmd `+` (or `=`), `−`, `0` registered once in the shell;
  ignored in inputs, textareas, selects and contenteditable. Toast
  "Text size 112%". Listed under Settings › Keyboard.
- 16.3 At 125% in the harness the command palette (60vh, top 12vh) and
  dialogs (`max-height: calc(100vh - 3rem)`, scrolling body) fit the
  window; no change was needed beyond the rem move in 14.4.
- Error hit: after an HMR update the harness page threw "stepScale is not
  defined" from a stale module; a full reload cleared it. Not a code bug.

### Milestone 4 — Updates screen (2026-09-24)

- 17.1 `repo/updates.rs`, command `list_updates(since?)`. `since` defaults
  to the previous completed sweep's end (one sweep: its start; runs with
  no sweep row: the start of the newest run's day). Per entity the newest
  ledger upsert after `since` is diffed against the newest at or before
  it, so an item touched twice in a sweep is one update. Rule order per
  §4.2; a proceeding whose due date changed and which closed in the same
  window lands in "Due date changed" only. `mask::text` masks PAN-shaped
  words and long digit runs in run notes. Rust test: two sweeps, one entry
  per rule.
- Limitation (Q39): the local `ledger` holds this device's own stream
  only — entries replayed from other devices are applied, not re-logged —
  so Updates is complete on the collector and near-empty elsewhere.
- 17.2–17.3 `screens/updates.tsx`, nav entry after Attention. Actions:
  View, Draft (notice with a due date) or ✦ Date (no due date), Open,
  Retry (`refresh_client`), Fix (client detail at the credentials card,
  route `#/clients/<id>/credentials`).
- 17.4 `export_updates`: one sheet per non-empty group, current header
  style.
- 17.5 Sidebar badge counts entries newer than `lcc.updates.seen_until`;
  the query sits under `work_items:` so ingestion events refresh it.

### Milestone 5 — Calendar (2026-09-24)

- 18.1 `lib/calendar.ts`: Monday-first month grid (whole weeks, outside
  days flagged), `groupByDay` over open items by effective due or issued
  date, `dayTone`. Pure; `today` is a parameter.
- 18.2 `screens/calendar.tsx`, nav entry after Updates. Month header with
  ‹ Today ›, Due / Issued toggle, count pills bottom-right (tones apply to
  the Due view only; every issued day is in the past, so the Issued view
  stays normal), selected day tinted, day list with View on hover,
  "n without a due date →" which sets Attention's No due date tile.
  Export of the selected day uses the existing export dialog.
- 18.3 Client and module come from `lcc.filters.attention` (moved the type
  to `lib/attention-filters.ts`); the chips' × writes back.
- 18.4 Arrow keys ±1/±7 days (crossing months), `t` today, Enter focuses
  the day list. Error fixed: the handler called `contains()` on a
  non-Node event target; now guarded with `instanceof HTMLElement`.
- App build + start check after milestone 4: built, ran 20 s against a
  scratch data dir without error.

### Milestone 6 — Work item detail: owner, notes, review (2026-09-24)

- 19.1 No change: the two-lane `ThreadFlow` stays (Q40).
- 19.2 `ui/item-meta.tsx` `OwnerRow` in the page head of all four detail
  screens (proceeding, demand, return, form), using the shared
  `ui/owner-select.tsx` that the Attention list already uses.
- 19.3 `NotesCard`: one textarea, saves on blur through
  `set_work_item_meta`, "Saved" toast, loads with `get_work_item_meta`.
- 19.4 Draft drawer "Mark reviewed" (disabled while edits are unsaved;
  once set it reads "Reviewed · Clear"). Generating a draft clears the
  mark in the core (14.3). Invalidating `work_items` refreshes the strip
  tile on return. Wired in the detail screen, the Attention list and
  Updates.

### Milestone 7 — Client 360 (2026-09-24)

- 20.1 No per-client flag existed. Migration 0019 `clients.sync_enabled`
  (default 1); `queue::create_sweep` skips disabled clients for whole-book
  and module scopes, which covers the scheduler; `Sync now` (client scope,
  `refresh_client`) still runs a disabled client on request. Command
  `set_client_sync_enabled`.
- 20.2 Migration 0020 `clients.note`; command `set_client_note` writes the
  client row, so the note syncs through the ledger. Both new `Client`
  fields skip serialising when unset (D-039 pattern) and `from_row` reads
  them tolerantly, because the 0009 backfill reads and writes clients
  before these columns exist. A cleared note is stored as "".
- 20.3 `client-detail.tsx`: header (38px avatar, name, PAN · GSTIN · phone
  as the screen already showed them, Sync switch, Sync now), five tiles
  (Open notices, Overdue, Demands total from the new `WorkItemRow.amount`,
  Returns filed "years with a filed return / years", Last synced from the
  new `ClientDetail.last_sync_at`), tabs Profile · Returns · Forms ·
  Demands · e-Proceedings · Notes, default e-Proceedings, tab in the route
  (`#/clients/<id>/<tab>`). Module tabs reuse the existing `ModulePane`
  with the year side list (now with "All years", the default).
- 20.4 Profile is the read view with Edit, which opens the existing
  `ClientForm` (a dialog, not an in-place swap: the form is only built as
  a dialog). Credentials card sits on Profile; `#/clients/<id>/credentials`
  opens Profile scrolled to it.

### Milestone 8 — Export polish, docs, close of Build 2 (2026-09-24)

- 21.1–21.2 Export: `LCC-<sheet>-<YYYY-MM-DD>-<HHMM>.xlsx` (IST), bold
  filled frozen header with autofilter, widths from the longest cell capped
  at 60, Owner and Note after the 16, "Active filters" provenance line.
  Attention, Client 360 module tabs, Updates and the Calendar day export
  what they show.
- 21.3–21.4 Docs 02, 08, 09, 11 and the user guide updated; D-041 to D-048.
- Errors hit in 21.5: clippy `needless_borrows_for_generic_args` on the
  new provenance line and `type_complexity` in `repo/updates.rs`; fixed
  (owned `format!`, a `ProceedingBits` alias). `./scripts/check.sh` then
  exits 0. The desktop app builds and ran 20 s against a scratch data dir.

#### What was built (Phases 14–21)

Attention v2 (sync line, needs-action strip, owner and search, chips,
Issued/Due lanes, saved views, list card with owners, notes and hover
actions), text size (settings stepper and Ctrl +/−/0, whole app in rem),
Updates (diff since the last sync, seen watermark, export, badge), Calendar,
owner/notes/Mark reviewed on every work item, Client 360 (sync switch,
tiles, tabs, client note), and export polish. Migrations 0017–0020.

#### Skipped or changed, with the question to answer

- No `TODO(blocked)` in this build.
- Detail thread kept as the two-lane flow (Q40); list note tooltip does not
  quote the note (Q38); Updates reads only this device's ledger (Q39);
  saved views built despite §9 (Q36); phase numbering (Q35); `--radius`
  (Q37). Q30–Q34 were built on their defaults.

#### How to test this build

Run `npm run tauri dev`, then: **Attention** — check the sync line, click
each strip tile and each Issued/Due bucket (counts elsewhere should not
move), add filters and watch the chips, save and rename a view, restart
the app and confirm the filters came back, hover a row (height must not
change) and try View, Draft, ✦ Date, Assign. **Settings › General** — step
the text size, try Ctrl + / − / 0, open ⌘K and a dialog at 125%.
**Updates** — after a sweep, check each group, Mark all seen, the sidebar
badge, Retry/Fix, Export. **Calendar** — arrows, `t`, Enter, Due/Issued,
the "without a due date" link, a client chip set on Attention. **Item** —
owner Change, notes (save on blur), Mark reviewed in a draft and the
Drafts to review tile. **Client** — Sync switch then a whole-book sweep
(the client is skipped), Sync now, the tiles, each tab, Profile → Edit,
Notes. **Export** — any list; check the file name, header row, widths,
Owner/Note columns and the "Active filters" line. Then answer Q30–Q40 in
`QUESTIONS.md`.

## Session 5 — 2026-09-24, answers applied, real data

### Dummy data removed (request 1)

- Browser preview harness deleted (it lived in the session scratch folder,
  never in git): its mocked Tauri core with 20 invented work items, six
  invented client names, sample owners, invented update entries and a
  sample client; its Vite config and the scratch app-data folder used for
  start checks.
- `src/screens/settings/general.tsx`: the text-size preview line no longer
  carries a sample PAN (`Notice u/s 143(1) · Due 30 Sep · Reply pending`).
- `src/screens/attention.tsx`: the save-view name placeholder "Rao –
  scrutiny" is now "View name".
- Tests added in Build 2 that docs/12 does not name, with their invented
  clients, owners and PANs: `repo/meta.rs`
  (`assignee_round_trips_through_the_ledger`), `repo/work_items.rs`
  (`issued_on_is_the_latest_inbound_communication`,
  `assignee_and_note_show_on_the_row`), `repo/updates.rs`
  (`two_runs_one_entry_per_rule`), `mask.rs`
  (`text_masks_pan_and_long_numbers`). Rust suite now 31 tests.
- Kept: tests docs/12 names (dates, ledger apply/resume/converge,
  snapshot + tail, ingestion streak/zero-row/resume/gaps, source
  independence), the scrubbed parser fixture
  (`sidecar/tests/fixtures/proceeding-cards.html`, docs/12 "Fixtures"), and
  the `type_registry` seed in migration 0003 (reference data, not sample
  data). Earlier-build tests that an accepted task required but docs/12
  does not name (bundle, GSTIN, intake modules, export columns, queue
  lock, scheduler, relay invariants, thread pairing, attention ranking)
  are kept pending Q41. Input placeholders that are hints ("Name, code or
  PAN", "you@firm.in") are UI copy, not data, and stay.

### Phase 22 — answers applied (request 2)

- Q30–Q37, Q40 confirmed the defaults; answers written into QUESTIONS.md.
- 22.1 (Q38) `note_preview` (first 120 characters) on every work-item row;
  the Attention note icon's tooltip shows it, with "…" when cut.
- 22.2 (Q39) Migration 0021 `ledger_received`. `ledger::apply` records each
  applied foreign entry under its merged local id in the same transaction.
  `repo/updates.rs` diffs `ledger` ∪ `ledger_received`. A device with no
  sweep or run rows takes `since` from received sweep-source entries,
  split into sweeps at gaps over 30 minutes. Sync-failed rows still come
  only from local `ingestion_runs`, so a non-collector shows no "Sync
  failed" group (runs are not synced). Entries applied before this build
  were not recorded, so a non-collector's Updates starts filling from its
  next sync.

### Phase 23 — blocked (request 3)

- TODO(blocked): `docs/17-scrape-scopes.md` does not exist in the tree.
  Phase 23 is a placeholder in `TASKS.md`; work continued with request 4.

## Session 6 — 2026-09-25, Build 3 (Phase 23, scrape scopes)

### Install
- `files.zip` unpacked: `docs/17-scrape-scopes.md` added, the Build 3 tasks
  replace the Phase 23 placeholder in `TASKS.md`, and the reading-order row
  is in `CLAUDE.md`. The five seeded questions became **Q42–Q46**, because
  Q41 was already taken.
- A second Claude session started Phase 23 in the same tree at the same time
  (uncommitted: sidecar v3, `walk.py` target and index, the start of
  migration 0022). The user gave this session ownership. Its sidecar work was
  kept. Two collisions were fixed: migration 22 was registered twice
  (`NotContiguous(22)` failed 22 tests), and `probe_state` and
  `deep_fetch_requests` were listed twice in `LOCAL_TABLES`.

### Built
- **23.A:** migration 0022, the scope JSON `{kind, selector, scheduled, …}`
  (old rows rewritten), sidecar protocol v3 (`probe`, `index`,
  `list.target`, in `sidecar/ingest/probe.py`), and the sweep settings as a
  superset of the schedule. `time` is read as `run_window_start`.
- **23.B:**
  - The frozen order and carry-over are in `repo/queue.rs`; probe state, deep
    requests, tiers, estimates and item plans are in `repo/scopes.rs`.
  - The pure decision table is `ingest/decide.rs`.
  - The runner rewrite covers probe, index, deep, item, window, timeout, the
    deep queue, warm cache, queued item fetches and the summary.
  - The new commands are in `commands/scopes.rs`.
- **23.C:** Sync screen (`screens/ingestion.tsx`, nav "Sync"), deep fetch
  dialog, Client 360 history line, pause reason and pin, Clients History
  column, add-client checkbox, the pending-documents icon on every list, the
  work item banner, Settings → Sweeps rows, and the Updates summary card with
  the History fetched group. UI styles are in `styles/sync.css`,
  `history.css` and `badges.css`.
- Tests: two new Rust tests for the 23.7 and 23.10 "done when" checks, and
  one sidecar test for the 23.3 probe hash. The five existing ingestion tests
  now set `docs_policy = download` and a wide lookback, so they keep their
  Build 1 meaning.
- Frozen sidecar rebuilt (`sidecar/build.sh`) so the app ships protocol v3.

### Errors hit
- `NotContiguous(22)`: the duplicate migration line (above).
- `cargo clippy --all-targets` reports `items_after_test_module` in
  `export.rs` and `queue.rs`. This predates Build 3, and `check.sh` runs
  clippy without `--all-targets`. Left alone.

### Real sweep (install step 4–5) — TODO(blocked)
- `NOTES.md` has no "Real data" heading, so the five clients are not
  registered or their folder is not recorded. The live sweep, deep fetch and
  item fetch were not run, and no live-portal fixes were made. Next session:
  register the clients (Clients → Add client, with the password in the
  credentials field), add the data folder path under "Real data", then run
  steps 4–5.

### Manual test list (Build 3)
1. **Settings → Sweeps.** Every row from docs/17 §6.5 shows and saves; the
   old schedule time appears as the window start.
2. **Clients.** History pills (`recent` by default). Add a client with "Also
   fetch full history tonight" ticked; Sync shows it as `Deep · full ·
   Queued · after sweep`.
3. **Client 360.**
   - The History line and `Fetch history` open the dialog: estimate,
     modules, depth; Queue for tonight replaces an existing request.
   - Turning sync off asks for a reason and shows `Paused · reason`.
   - The overflow menu pins the client to nightly.
4. **Sync.** `Sweep all now` shows an estimate. During a run: the run card,
   progress and legend, rows in frozen order, status strings, a live
   `Running · m:ss`, hover `Sync now` / `Retry`, the persisted filters, and
   the live session with OTP / captcha. Under "More sweep options": the
   module picker and Sweep what is due.
5. **First sweep of a client.** Rows are indexed with no downloads, and cloud
   icons appear on Attention, Calendar, Updates, and the client's list.
6. **Work item with pending documents.** The banner auto-fetches (Settings →
   "Fetch documents when I open an item"), shows progress, then disappears.
   While a sweep runs, it offers "Queue after sweep".
7. **Second sweep of an unchanged client with no open items.**
   `Skipped · unchanged` shows within seconds.
8. **Scheduled run.** Set a window a few minutes wide. It stops with
   "Stopped · window closed", and the next scheduled run starts with the
   remainder.
9. **Updates.** The "Last night" card is first and counts in the badge;
   History fetched appears after a deep fetch.
10. **Dormant.** A client with no open items and nothing in 90 days goes
    `weekly` after its sweep and shows `Dormant` / `Weekly · Sun` on Sync.
11. Then answer Q42–Q48 in `QUESTIONS.md` (and Q41 from Build 2).

## Session 7 — 2026-09-25, Build 4 (Phases 25–29)

### Install
- `files.zip` carried `18-build-4.md`, the Phase 25–30 tasks and nine seeded
  questions. The questions were renumbered **Q49–Q57** (the notes said
  Q46–Q54, already used by Build 3); every reference in the spec and tasks
  was rewritten. The mockup PNGs (`docs/mockups/build-4/`) did not arrive:
  built from the spec's prose (Q58).

### Built
- **25** cumulative windows (`lib/windows.ts`), risk strip, hint line,
  saved-view and filter migration on read (`lib/filters-migrate.ts`, Q49),
  Calendar next-days strip.
- **26** migration 0023 (`ao_viewed_first_seen_at`,
  `type_registry.is_assessment`, synced `proceeding_events`), the
  not-viewed-by-AO predicate as one SQL fragment (Q53), `set_limitation_date`
  with its event, AO / limitation cells everywhere, notice-type pill and Type
  chip, Updates groups AO viewed and Limitation.
- **27** export: declarative proceedings column table (16 + Viewed by AO +
  Limitation Date + Owner + Note), four-row header block with the filter-line
  grammar, `preview_export_sheet`, filename slug, the dialog with the column
  picker (remembered in `Settings.export_columns`, Q54) and sheet preview.
- **28** `export_clients` (17 columns, never a credential), per-client sync
  health, Result column, registered / with sync failures count, GSTIN search,
  footer copy.
- **29** Sweep screen: Nightly card (role pill, five stats, Run now, Export
  run log → `export_sweep_run`), Deep fetch card, `deep_probe_info`,
  `indexed` and `ao_viewed_flips` on the sweep summary, Clients failures
  filter (`#/clients?failures`), nav label Sweep.

### TODOs pushed through
- TODO(blocked): mockups absent; layout follows the spec text and the design
  system (Q58). Refit when the PNGs land.
- The Build 2 "Drafts to review" and "No due date" tiles are off the strip
  (Q59); rank 4 still groups the no-date rows and the Calendar link lands on
  a hidden `nodate` tile filter.
- Row 3 of the header block (Client · Module · Status) is read from the
  rows each sheet holds, since `ExportScope::View` gained no fields.
- Nothing was run in the app; `./scripts/check.sh` is the only gate.

### Manual test list (Build 4)
1. Attention: pick Issued Last 15 — the hint line names the dates; Last 7 ≤
   Last 15 ≤ Last 30 counts; a saved view from Build 2 that held "8–15 d"
   opens as Last 15.
2. Risk tiles filter; the AO tile and the Limitation tile set chips.
3. An assessment proceeding shows Viewed by AO and Limitation columns; other
   rows show —; the columns hide when no assessment row is listed.
4. Work item: set a limitation date; Updates shows a Limitation entry; the
   header shows days left; the thread's trailing event carries the date.
5. After a sweep where a reply's "viewed by AO" date appears: the response
   card shows the event with "first seen", Updates shows AO viewed, the
   Sweep card counts one AO-viewed flip.
6. Export · N rows: the dialog's preview matches the sheet; untick Note and
   reopen — it stays unticked; the file name is `LCC_issued-15d_<date>.xlsx`.
7. Clients: Result column, "n registered · m with sync failures", Export all
   clients writes 17 columns and no password; search by GSTIN.
8. Sweep: role pill, stats from the last run, Export run log; Deep fetch one
   client with Everything / Last 3 AYs / Since date, Index + download PDFs.
9. Then answer Q49–Q60 in `QUESTIONS.md`.

## Session 8 — 2026-09-25, Build 5 (Phase 31, statutory calendar)

### Install
- New `files.zip` (spec "18-statutory-calendar", tasks "Build 4 / Phase 25",
  questions Q46–Q50) collided with Build 4 on every number. Installed as
  **docs/19**, **Build 5 / Phase 31**, **Q61–Q65** (D-067). `vcfo-suite`
  is at `~/Documents/vcfo-suite` (hyphen), read-only.

### 31.A
- Migration 0024: `statutory_deadlines`, `statutory_fetches`, `firm_dates`,
  `statutory_events`, four client profile columns. All synced.
- `statutory/parse.rs` (page walk, ids, extension regex), `rules.rs` (two
  ordered tables; audit moved above ITR, Q67), `fetch.rs` (hash, diff,
  never deletes), `repo.rs` (lists, firm dates, `.ics`), `mod.rs`
  (settings KV, FY maths, cadence). Commands in `commands/statutory.rs`.
- The public step runs at the start of a scheduled whole-book run (D-069).
- **TODO(blocked) 31.2:** the portal returns 403 to every fetch from this
  machine (curl with browser headers, headless Chromium). The fixture at
  `sidecar/tests/fixtures/statutory/yearly-deadlines-2026.html` is
  **synthetic**, labelled so in its first comment, in the structure docs/19
  §2.1 describes. Replace it with the real page when one can be fetched;
  the parser tests then pin the real markup (Q66).
- `regex` crate added.

### 31.B and 31.C
- `lib/calendar-grid.ts` (Monday-first grid, keyboard moves, status, heat,
  pill label, FY maths, the legend table), `lib/calendar-prefs.ts`,
  `styles/calendar.css` (every vcfo `stat-cal-*` / `stat-max-*` rule in LCC
  tokens, fixed dot and pill slots, reduced-motion flash, print sheet).
- `screens/calendar.tsx` rebuilt as the card; it exports `useCalendarState`
  and the agenda/legend pieces the overlay reuses, so month, scope, mutes
  and the selected day are one state. Build 2's Notices behaviours (day
  counts, Due/Issued, chips from the Attention filters, keyboard) live on
  as the Notices layer; Build 4's limitation dates stay as Notices-layer
  rows. `lib/calendar.ts` keeps only the Notices grouping; the Build 2 grid
  builder and its CSS were removed as dead.
- `ui/calendar-overlay.tsx`: Month (trimmed weeks, three pill slots, right
  panel), Year (4×3 heat), Agenda (FY, today pinned, j/k); collapses the
  sidebar via a `nav-collapsed` class on the shell and restores it; body
  scroll lock; Escape returns focus; `.ics` and Print month.
- `ui/nav-mini.tsx`: sidebar "Next deadlines" (icon + badge when
  collapsed) and the Attention "Next statutory" tile (strip is five wide).
- Updates: "Deadline extended" after "Due date changed"; "Calendar
  changed" last. Route `#/calendar/<day>` opens the day.
