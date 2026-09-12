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
_(nothing yet)_

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
