# 04 · Build order (ONE CONTINUOUS PASS)

Run phases 0→6 straight through. **Do NOT stop between phases. Do NOT ask
anything. Do NOT run or test anything** (see Operating mode in `CLAUDE.md`).
Each phase lists the artifacts to **build** — produce them and move on.

## Phase 0 · Scaffold
Build: Tauri 2 + Vite + React + TS + Tailwind + shadcn project; Tauri updater
plugin wired (key generated, feed may be stubbed); a placeholder window.

## Phase 1 · Sidecar
Build: `run_backend.py` entry launching `uvicorn app.main:app` on env HOST/PORT;
the whitelisted `app/` edits (`/health`, CORS, env host/port/token); a PyInstaller
spec producing `notice-desk-backend` (`--onefile`); Tauri `externalBin`
registration; Rust layer that spawns/monitors/kills the sidecar, injects the
token, and polls `/health` before showing the window; first-run
`playwright install chromium` into app-data.

## Phase 2 · UI (screen-for-screen from `app/static`)
Build these screens, all wired to the API in `03-api-contract.md`:
password gate; credential entry; sync pipeline with live viewport (WS frames) +
Slow/Fast/Extreme buttons; OTP freeze modal; notices table with due-date buckets
(overdue / due-soon) + attention list; summary/report + `export.xlsx`; notice
detail with AI draft preview/edit and PDF preview. Add no features beyond these.

## Phase 3 · Secrets
Build: OS-keychain storage for portal creds + `APP_PASSWORD` + LLM key, injected
into the sidecar at spawn; keep a memory-only ("ask each time") default path.

## Phase 4 · Encryption
Build: SQLite opened via SQLCipher with a key from the keychain. If wiring is
non-trivial, ship plain SQLite and leave `TODO(sqlcipher)` + a NOTES.md line —
do not block.

## Phase 5 · Auto-update
Build: Tauri updater config — static manifest + signed artifacts; in-place swap.

## Phase 6 · CI (GitHub Actions, Windows)
Build: a `windows-latest` workflow that builds the PyInstaller sidecar on
Windows, then `tauri-action` builds the `.exe` + NSIS installer, code-signs, and
publishes the updater manifest. See `07-ci-release.md`. Do not cross-compile
from Linux.

## Build complete when
All of the following exist and are committed (NOT verified — the human verifies):
1. Tauri app with the React UI and all Phase-2 screens.
2. Sidecar packaging + spawn/monitor wiring.
3. Keychain + (SQLCipher or its TODO).
4. Updater config + the Windows CI workflow.
5. `NOTES.md` listing every default chosen and every TODO/known-gap.
Then stop.
