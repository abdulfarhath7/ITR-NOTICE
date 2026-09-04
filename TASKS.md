# TASKS — desktop port (tick [x] when the artifact exists; the human verifies)

## Phase 0 · Scaffold
- [x] Tauri 2 + Vite + React + TS scaffold
- [x] Tailwind + shadcn set up
  - [x] primitives hand-written into `src/components/ui` (no network CLI run)
- [x] Tauri updater plugin wired (key generated)
  - [ ] real signing key + feed URL — placeholders in `tauri.conf.json` (see Q2)
- [x] Placeholder window opens via `tauri dev`

## Phase 1 · Sidecar
- [x] `run_backend.py` (uvicorn on env HOST/PORT)
- [x] `app/` whitelist edits: `/health`, CORS, env host/port/token
- [x] PyInstaller spec builds `notice-desk-backend`
- [x] Tauri `externalBin` sidecar registered
- [x] Rust spawn / monitor / kill + token injection
- [x] `/health` polled before window shows
- [x] first-run `playwright install chromium` into app-data

## Phase 2 · UI (screen-for-screen)
- [x] typed API client (`lib/api.ts`) + WS client (`lib/ws.ts`)
- [x] password gate
- [x] credential entry
- [x] sync pipeline + live viewport (WS frames)
- [x] Slow / Fast / Extreme controls
- [x] OTP freeze modal
- [x] notices table + due-date buckets + attention list
- [x] summary / report + `export.xlsx`
- [x] notice detail: AI draft preview/edit + PDF preview
  - [x] command palette (Ctrl K) + keyboard shortcuts, as on the web

## Phase 3 · Secrets
- [x] keychain storage for creds / APP_PASSWORD / LLM key
  - [x] Stored-secrets dialog in the app (`src/features/settings`)
- [x] inject secrets into sidecar at spawn
- [x] memory-only "ask each time" default path

## Phase 4 · Encryption
- [x] SQLCipher open with keychain key (or `TODO(sqlcipher)`)
  - [x] shipped plain SQLite + `TODO(sqlcipher)` in `run_backend.py` (see Q5)

## Phase 5 · Auto-update
- [x] Tauri updater manifest + signing config

## Phase 6 · CI (GitHub Actions, Windows)
- [x] `windows-latest` workflow
- [x] build sidecar on Windows (PyInstaller)
- [x] `tauri-action` → `.exe` + NSIS
- [x] code signing wired (secrets)
- [x] updater manifest published
  - [x] `createUpdaterArtifacts` + `tauri-action` publishes `latest.json`

## Housekeeping
- [x] NOTES.md kept current
- [x] QUESTIONS.md kept current
- [x] final commit

## Not in the plan, built anyway (say so plainly)
- [x] placeholder app icons + `packaging/make_icons.py` (Tauri will not bundle without them)
- [x] `packaging/build_sidecar.py` — freezes the sidecar and names it for the Rust target triple
