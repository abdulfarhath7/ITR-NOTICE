# TASKS — what exists today (the human verifies; nothing here was tested)

Rewritten 2026-09-04 against the code in the tree. The old board tracked the
FastAPI-sidecar design, which no longer exists — see "What changed" in
`CLAUDE.md`.

## Phase 0 · Shell
- [x] Tauri 2 + Vite + React 18 + TS scaffold (`npm`, no Tailwind — plain CSS)
- [x] Window config, CSP that allows `blob:` frames for the PDF viewer
- [x] Capabilities locked to `core:default` — no plugin surface in the webview
- [x] App icons (`app-icon.png` → `src-tauri/icons/*`)
- [ ] Auto-update — deliberately not built (Q2)

## Phase 1 · Sidecar (portal automation as a child process)
- [x] `sidecar/app/portal/*` copied byte-for-byte from the web tool
- [x] `sidecar/notice_scraper.py` — JSON-lines protocol over stdin/stdout
- [x] Staging-cache handoff: push the row + PDF to Rust, scrub the blob to a
      1-byte marker so the "already fetched" rule still works
- [x] `notice_scraper.spec` — PyInstaller `COLLECT` with `collect_all("playwright")`
- [x] `sidecar/build.sh` / `build.ps1` — `PLAYWRIGHT_BROWSERS_PATH=0` then freeze
      into `src-tauri/resources/scraper/`
- [x] `scraper.rs` — spawn, locate (bundle dir, then `sidecar/dist` for dev),
      stdout protocol, stderr to the log pane, `kill_on_drop`, `stop`

## Phase 2 · Rust core
- [x] `db.rs` — SQLCipher archive, schema mirroring the web tool's `app/db.py`
- [x] `absorb_notice` upsert: portal dates never overwrite a Claude date
- [x] `keychain.rs` — archive key (32 random bytes, generated once), portal
      password per user id, firm token
- [x] `claude.rs` — proxy client, bearer auth, 300 s timeout
- [x] `lib.rs` — settings file, 15 commands, `scraper` event channel

## Phase 3 · UI
- [x] `lib/api.ts` typed `invoke` wrapper + `onScraper` event subscription
- [x] Rail: bucket counts, connect / fetch / export / settings
- [x] Notices list with due-date buckets (`lib/buckets.ts`, ported from `report.py`)
- [x] Drawer: notice detail, PDF preview (blob URL), draft preview + edit
- [x] Connect modal: user id / password / remember, OTP freeze, live log
- [x] Settings modal: proxy URL + firm token
- [x] Excel export (`lib/exportXlsx.ts`, three sheets)
- [ ] Speed control — `portal_speed` command exists, no UI calls it
- [ ] Live browser viewport — dropped with the websocket; not rebuilt
- [ ] Command palette / keyboard shortcuts — dropped in the rewrite

## Phase 4 · Encryption
- [x] SQLCipher via `rusqlite` `bundled-sqlcipher-vendored-openssl`
- [x] Raw-key `PRAGMA key = "x'<hex>'"`, key from the keychain
- [x] Schema touched on open so a wrong key fails loudly at open time

## Phase 5 · Proxy
- [x] `proxy/main.py` — `/v1/due-date`, `/v1/draft`, `/healthz`
- [x] Per-firm bearer tokens (`FIRM_TOKENS`), constant-time compare
- [x] Stateless, nothing logged, nothing stored
- [ ] Deployed anywhere (Q11)
- [ ] Model id confirmed against the current Anthropic model list (NOTES.md)

## Phase 6 · CI / release
- [x] `.github/workflows/release.yml` — `windows-latest`, tag-triggered
- [x] Tag/version agreement check
- [x] Sidecar frozen on the runner via `sidecar/build.ps1`
- [x] `tauri-action` → NSIS installer, draft release
- [x] Optional Authenticode signing from `WINDOWS_CERT`
- [x] `cargo check` passes on Linux (5 MutexGuard/`?` errors fixed; see NOTES)
- [x] A green Windows CI run — v0.1.1, run 34102102136, 24 min, 246 MB NSIS installer
- [ ] `requirements.lock.txt` for the sidecar (Q8)
- [ ] Code-signing certificate (Q9)

## Housekeeping
- [x] README rewritten for the current architecture
- [x] `docs/` rewritten for the current architecture
- [x] CLAUDE.md / TASKS.md / QUESTIONS.md / NOTES.md rewritten
- [x] `postcss.config.js` deleted + dead TS trees excluded in `tsconfig.json`
      (they broke `npm run build`, i.e. the release job)
- [ ] Delete the rest of the dead files from the old design (listed in NOTES.md)
- [ ] Commit the working tree (nothing since `01d21f8` has been committed)
