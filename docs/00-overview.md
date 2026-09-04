# 00 · Overview

## Goal
Ship the existing income-tax **notice + litigation** tool (currently a
FastAPI + Playwright + SQLite + vanilla-JS web app) as a **beautiful, native,
local-first Windows desktop app** built on Tauri 2 — reusing the backend as-is.

## In scope
- Tauri 2 desktop shell (signed installer + auto-update).
- New React + TS UI that reproduces every existing screen and flow.
- Bundling the existing Python backend as a managed loopback sidecar.
- OS-keychain secret storage; encrypted local DB.
- GitHub Actions build for Windows.

## Non-goals (do not build)
- No rewrite of the Python backend logic.
- No macOS/Linux release yet (dev on Linux is fine; shipping is Windows only).
- No new product features beyond what the current web app already does.
- No central server for user data. The only backend service is a thin,
  optional LLM/update/license tier described in `06` and `07` — do not put
  client data through it.

## Success in one sentence
`pnpm tauri dev` on Linux runs the whole loop against a real sidecar, and
GitHub Actions emits a signed Windows installer that auto-updates.
