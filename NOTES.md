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
