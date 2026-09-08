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

## Phase 3 · UI  (rebuilt 2026-09-07 as the old static dashboard)

The Tailwind/shadcn rail-and-drawer UI is gone. `src/` now holds a faithful
React port of `app/static/{index.html,style.css,app.js}` wired to the Tauri
command layer instead of the FastAPI routes. `src/styles.css` is byte-for-byte
`app/static/style.css`; the two Geist woff2 faces are served from `public/fonts`
so its `url('/fonts/…')` rules did not have to change.

- [x] `lib/api.ts` typed `invoke` wrapper + `onScraper` event subscription
- [x] `styles.css` copied verbatim; Geist + Geist Mono self-hosted; dark-first
      with the `data-theme` toggle
- [x] Header — brand, status dot + label, download limit, Slow/Fast/Extreme,
      theme, ⌘K, Log out, Export, Sync
- [x] Gates — portal login card (`portal_login`) and OTP card (`portal_otp`),
      shown by phase
- [x] Overview — five metric cards + the last-sync line
- [x] Live viewport — REC light, lock/phase animation, phase steps; run log
      card beside it, both fed by the `scraper` channel
- [x] Report "Position at a glance" — run line, bucket chips that filter the
      table, Attention table (`lib/summary.ts`, counting exactly as `report.py`)
- [x] Filters + notices table — AY, proceeding-contains, missing-due toggle,
      count; Notice / Proceeding / Issued / Due chip / Status ticks / Actions
- [x] Row actions — View, Save, "✦ Date" (`ask_due_date`), Draft
      (`draft_response`); all four only when a PDF is held
- [x] PDF viewer modal (blob URL from `get_notice_pdf`)
- [x] Draft drawer — summary, checklist, editable text, Save edits
      (`save_draft_text`), View, Save, Copy, Regenerate
- [x] ⌘K command palette + the `s` / `/` / Escape shortcuts
- [x] Toast
- [x] Speed control — the segment calls `portal_speed`, and re-sends the chosen
      pace on `login_ok` so a sidecar spawned later still gets it
- [x] Excel export (`lib/exportXlsx.ts`, three sheets)
- [x] Live viewport **frames** — `_viewport_loop` in the sidecar screenshots the
      page every 1.5s at JPEG q45 and emits `{"ev":"viewport","img":…}`;
      `scraper.rs` already passed unknown events through untouched. Withheld for
      the whole of login and the OTP wait (`safe_to_capture()`), so a credential
      is never photographed. REC lights only while frames arrive
- [ ] Draft PDF — the web tool rendered one server-side (`app/response_pdf.py`);
      the drawer's View/Save hand over the draft text instead
- [ ] `runs` table — nothing writes it, so the last-sync line is remembered from
      the sidecar's own `sync_done` stats in `localStorage`

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

## Phase 7 · Brand + UI (2026-09-08)
- [x] Renamed to Litigation Command Center / LLC across app, docs and CI
- [x] `identifier`, keychain service, npm/Cargo package names, storage keys
- [x] `src/styles.css` rewritten as the command-centre design system
- [x] Header, Overview, Watch, Report, Notices, Gates re-marked up for it
- [x] Colour-graded run log (`lineTone`)
- [x] New app icon — plasma hexagon in viewport brackets (`make_icons.py`)
- [x] `tsc && vite build` clean; dark + light verified under Playwright
- [ ] Real artwork for the icon, not the generated placeholder
- [ ] Decide "LLC" vs a name that does not collide with "limited liability
      company" (Q16), and whether the old `%APPDATA%` needs a migration

## Housekeeping
- [x] README rewritten for the current architecture
- [x] `docs/` rewritten for the current architecture
- [x] CLAUDE.md / TASKS.md / QUESTIONS.md / NOTES.md rewritten
- [x] `postcss.config.js` deleted; `tailwind.config.js` and `components.json`
      deleted with the shadcn UI
- [x] `tsconfig.json` rewritten — the `@/*` alias is back, and only the three
      lib files that cannot compile are excluded (see NOTES.md)
- [ ] Delete the rest of the dead files from the old design (listed in NOTES.md)
- [ ] Commit the working tree (nothing since `01d21f8` has been committed)
