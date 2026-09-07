# NOTES — technical log

Rewritten 2026-09-04, against the code in the tree. The previous NOTES described
the FastAPI-sidecar port (loopback HTTP, launch tokens, `run_backend.py`,
`packaging/build_sidecar.py`). That design is gone; nothing in this file refers
to it except the "Dead files" section.

**Almost nothing here has been run.** `tsc` and `vite build` pass over the live
frontend (the dead trees are excluded — see below). `cargo check` was attempted
on this Linux box; whatever it reports is in this file's last section. No
sidecar freeze, no app launch, no sync, no test. The human does all real
verification, on Windows.

## How it fits together

```
React (WebView2)  --invoke()-->  Rust core  --stdin/stdout JSON-->  notice_scraper.exe
       ^                            |
       |  Tauri event "scraper"     +--> archive.db (SQLCipher, %APPDATA%)
       +----------------------------+--> Credential Manager
                                    +--> https --> proxy/main.py --> Claude
```

- 15 `#[tauri::command]`s in `lib.rs`; one event channel named `scraper`.
- The webview has `core:default` and nothing else — no fs, dialog or shell
  plugin. Anything the UI needs from the OS goes through a Rust command.
- The sidecar is a *folder* (PyInstaller `COLLECT`), shipped via
  `bundle.resources`, not `externalBin`. `externalBin` copies a single file and
  would separate `notice_scraper.exe` from its `_internal/`.

## The archive
- SQLCipher through `rusqlite` (`bundled-sqlcipher-vendored-openssl`) — nothing
  to install on Windows, but the first `cargo build` compiles SQLCipher *and*
  OpenSSL from source. Expect it to be slow, and expect it to need Perl (and
  NASM) on the build machine; GitHub's `windows-latest` image ships both.
- Key: 32 random bytes, hex, generated on first launch, stored in Credential
  Manager as `in.noticedesk.app / archive-key`. **Lose the Windows profile and
  the archive is unreadable.** Any backup story has to export the key too.
- `PRAGMA key = "x'<hex>'"` is issued as the first statement, raw-key form so no
  KDF runs. The schema is then touched on the same connection, so a wrong key
  fails at open with "file is not a database" instead of somewhere later.
- The upsert in `absorb_notice` keeps the web tool's rule: a Claude-sourced due
  date is never overwritten by a portal one, and a replayed row without a blob
  never clears an existing PDF.

## The sidecar
- `sidecar/app/portal/*` is byte-for-byte identical to the web tool's
  `app/portal/*` (verified with `diff -r`). Keep it that way; a selector fix
  belongs in both.
- Staging handoff: the scraper still writes its own SQLite (`staging.db` in
  app-data). `notice_scraper.py` reads the committed row, emits it with the PDF
  as base64, then overwrites the staging blob with a 1-byte marker `\x01`. The
  scraper's "already fetched" test is `pdf_blob IS NOT NULL`, so the cache still
  works and no plaintext PDF sits on disk.
- Chromium **is** bundled, unlike the old design. `PLAYWRIGHT_BROWSERS_PATH=0`
  before `playwright install chromium` puts the browser inside the playwright
  package so `collect_all("playwright")` sweeps it in. Miss that line and the
  installed app fails at first login with "Executable doesn't exist". It also
  makes the installer large — expect a few hundred MB.
- `scraper.rs` looks for the exe in the bundle resource dir, then
  `../sidecar/dist/notice_scraper/` so `tauri dev` works from the repo.
- `kill_on_drop(true)` plus an explicit `stop` (send `{"cmd":"stop"}`, wait 5 s,
  then kill). There is no shell-pid watchdog any more; if a hard-killed shell
  ever leaves a `notice_scraper` alive on Windows, that is where to look.

## The proxy
- `proxy/main.py` holds the Anthropic key and both prompts. The desktop app
  knows only a base URL and a bearer token. Keep it that way — the moment a key
  ships inside the installer, every firm has your key.
- Verified against the current Anthropic API reference: `claude-sonnet-4-6` is a
  current model id, `output_config: {"format": {"type": "json_schema", ...}}` is
  the current structured-output shape, and `thinking={"type": "adaptive"}` is
  correct for it. No change needed. Worth knowing when you tune cost: Sonnet 5
  (`claude-sonnet-5`) is cheaper per token than Sonnet 4.6 ($2/$10 vs $3/$15 per
  1M) and Opus 5 (`claude-opus-5`) is the stronger default for reasoning work.
- No metering, no rate limit, no cap (Q11). `FIRM_TOKENS` is an env var, so
  adding or revoking a firm is a redeploy (Q10).
- `client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])`
  runs at import, so the process refuses to start without the key. Deliberate.

## Known gaps / TODO
- **Nothing is committed.** Everything described here is an uncommitted working
  tree on `main`; the last commit (`01d21f8`) is still the old design.
- **`portal_speed` has no UI.** The command and the sidecar's `speed` handler
  both exist; nothing calls them. Pacing is stuck at the sidecar default 0.4 s.
- **The live viewport is gone.** It rode on the websocket. The connect dialog
  shows a text log instead. `HEADLESS` can be forced to `false` with the
  `NOTICE_HEADLESS` env var, which is currently the only way to watch a run.
- **Excel export uses `XLSX.writeFile`**, i.e. a browser download inside
  WebView2, with no save dialog and no fs plugin. Verify where the file actually
  lands on Windows; if it silently does nothing, this needs a Rust command that
  writes bytes to a path the user picked.
- **No updater** (Q2). `tauri.conf.json` has no `plugins.updater` block and
  `Cargo.toml` no updater plugin, so an installer is the only route to a new
  version.
- **Dependencies are unpinned** — `sidecar/requirements.txt` is `playwright`,
  `python-dotenv`, `pyinstaller` with no versions (Q8).
- **`.env` at the repo root is the old web tool's.** The desktop app reads no
  `.env`; the sidecar's `app/config.py` still calls `load_dotenv()` for
  `HEADLESS` / `HOLD_ON_ERROR`, and the Rust side passes those in as env vars.
- **`app-icon.png` and the generated icons are placeholder artwork.**
- **`db::get_notice` lists every notice and filters in Rust.** Fine at a few
  hundred rows, wrong shape at ten thousand.

## Dead files from the old design
None of these are imported by anything that builds today. Left in place rather
than deleted, because deleting is the human's call:

| Path | Why it is dead |
|---|---|
| `src/app/`, `src/features/`, `src/components/ui/`, `src/styles/globals.css` | the Tailwind/shadcn UI; `main.tsx` now renders `src/App.tsx` |
| `src/lib/ws.ts`, `runtime.ts`, `secrets.ts`, `files.ts`, `format.ts`, `utils.ts` | websocket + loopback + plugin helpers; nothing imports them |
| `src-tauri/src/secrets.rs`, `src-tauri/src/sidecar.rs` | not declared as modules in `lib.rs` |
| `run_backend.py`, `packaging/` | froze the FastAPI sidecar; CI no longer calls them |
| `requirements.txt` (root), `Dockerfile`, `docker-compose.yml`, `run.sh` | the web tool's deployment |
| `pnpm-lock.yaml`, `tailwind.config.js`, `components.json`, `tsconfig.node.json` | pnpm + Tailwind + shadcn, all dropped |
| `Screenshot From 2026-09-03 23-31-14.png` | a screenshot that got committed to the working tree |

`app/` itself (the whole web tool) is a deliberate keep — see Q12.

Two of them were not merely untidy — they broke `npm run build`, which is what
`tauri build` runs, so the release job would have failed:
- `postcss.config.js` loaded `tailwindcss` and `autoprefixer`, neither of which
  is installed any more. **Deleted** (it is in git history if you want it back).
- the dead TS trees still import the `@/` path alias and plugins this app no
  longer has, so `tsc` failed on them. They are now listed in `tsconfig.json`'s
  `exclude`. Deleting the trees is the real fix; then drop the exclude block.

`package-lock.json` is now committed (it used to be gitignored in favour of
pnpm) because CI runs `npm ci`.

## Verification checklist for the human (Windows)
1. `.\sidecar\build.ps1` — then run `src-tauri\resources\scraper\notice_scraper.exe`
   directly and type `{"cmd":"login","user_id":"...","password":"..."}` at it.
   It should answer `{"ev":"ready"}` first and drive a real browser after that.
2. `npm ci && npm run tauri dev`. First build is long (SQLCipher + OpenSSL).
3. Connect → OTP → Fetch. Confirm rows appear as they are committed, not only at
   the end, and that the PDF opens in the drawer.
4. Settings → proxy URL + firm token → a notice with no due date → "Ask Claude".
5. Close the app from the taskbar; confirm no `notice_scraper.exe` survives.
6. `%APPDATA%\in.noticedesk.app\archive.db` — open it with plain `sqlite3`. It
   must refuse. That is the encryption working.

## First `cargo check` (Linux dev host, 2026-09-04)
It compiles. Five errors had to be fixed first, all the same one in `lib.rs`:

```
error[E0308]: `?` operator has incompatible types:
              expected `Connection`, found `MutexGuard<'_, Connection>`
```

`db::list_notices(&lock_db(&state)?)` looks like it should deref-coerce
`&MutexGuard<Connection>` to `&Connection`, and it would — but the expected type
propagates inward through the `&` to the `?` expression, and the coercion never
gets a chance. Binding the guard first (`let con = lock_db(&state)?;` then
`&con`) compiles, because the coercion then happens on a place expression. Five
call sites: `list_notices`, `get_notice_pdf`, `get_draft`, `save_draft_text`,
`ask_due_date`.

Nothing else was reported — no warnings. Note this was `cargo check` for the
**Linux host target** with `bundled-sqlcipher-vendored-openssl`; the MSVC build
in CI is the one that matters and has never run.

## First green Windows CI run (2026-09-07)
Tag `v0.1.1`, run 34102102136, 24 minutes end to end. The MSVC build of
SQLCipher + OpenSSL compiles clean, the sidecar freezes with Chromium inside,
and NSIS produces `Notice Desk_0.1.1_x64-setup.exe` (246 MB). The draft
release and the `notice-desk-windows` artifact both carry it.

One fix was needed first: a stale `pnpm-lock.yaml` from the old design was
still tracked, and `tauri-action` picks its package manager from the first
lockfile it sees. It ran `pnpm tauri build` and the runner has no pnpm. The
lockfile is deleted; `package-lock.json` is the only one now.

`v0.1.0` was already used by the old loopback-sidecar design, so the version
was bumped to 0.1.1 in `tauri.conf.json`, `Cargo.toml` and `package.json`
rather than moving that tag. That draft release is still on GitHub and can be
deleted.

Not verified: nothing has been *run* on Windows yet. First things that can
break on the CA's machine, in order: WebView2 bootstrapper download (needs
internet at install), the sidecar failing to start under `CREATE_NO_WINDOW`,
SmartScreen blocking the unsigned installer (click "More info → Run anyway").

## The UI rewrite (2026-09-07) — back to the static dashboard

The Tailwind/shadcn rail-and-drawer UI has been replaced by a React port of the
web tool's own dashboard, `app/static/{index.html,style.css,app.js}`. The look
is the old one; the wiring is the Tauri command layer. Deleted: `src/App.tsx`
(the old one), `src/app/`, `src/components/`, `src/features/`, `src/hooks/`,
`src/styles/`, `tailwind.config.js`, `components.json`. Everything in `src/lib/`
was kept.

**How faithful.** `src/styles.css` is a byte-for-byte copy of
`app/static/style.css` — `diff` says nothing. Its `@font-face` rules point at
`/fonts/Geist-Variable.woff2`, so both faces went into `public/fonts/` rather
than into `src/`, and Vite serves them at that exact path (they land in
`dist/fonts/`). `index.html` carries `data-theme="dark"` and the two font
preloads. No CSS was written for these screens; every class is the old one.

**What is genuinely different, and why**

| Old | Now | Why |
|---|---|---|
| `fetch('/api/…')` + `/ws` | `invoke()` + the `scraper` Tauri event | There is no server |
| `GET /api/summary` counted the report server-side | `lib/summary.ts` counts it in the window | Same rules as `app/report.py` — same labels, same order, same GROUPS total, same attention sort |
| `GET /api/export.xlsx` | `lib/exportXlsx.ts` (kept) | Already client-side |
| `POST /logout` + `location.reload()` | `portal_stop` + a state reset | Reloading would only throw away the archive rows it just loaded |
| theme in a cookie | theme in `localStorage` | The cookie existed so the server could read it |
| draft PDF from `app/response_pdf.py` | the drawer's View/Save hand over the draft **text** | Nothing in the Rust core renders a PDF |
| server-held `runs` table drove "Last sync …" | remembered from `sync_done` stats in `localStorage` | `db.rs` creates the `runs` table but nothing ever inserts into it |
| server chose the pace from a `slow/fast/extreme` mode | the same three modes, mapped to the seconds `portal_speed` takes (1.0 / 0.25 / 0.0 — `app/main.py`'s own `MODES`) | The command's argument is seconds |
| no settings screen (key was in the server's `.env`) | a small Settings modal, reachable only from ⌘K | The proxy URL and firm token have to come from somewhere, and the header had to stay the old header (QUESTIONS Q13) |
| no "remember" control | a checkbox in the login card | `portal_login`'s `remember` argument needs a source, or the keychain is never written (Q13) |

**Two date helpers, on purpose.** The due chip and the five metric cards use
`lib/format.ts`'s `dueInDays`, which is `app.js`'s function verbatim
(`Date.parse`). The buckets, the attention table and the export use
`lib/buckets.ts`'s `daysLeft`, whose `parseDate` handles the portal's
`17-Aug-2026` explicitly and is what `report.py` does. They agree on every shape
the portal emits; they could disagree on a hand-edited row, and if that ever
shows up the answer is to move the chip onto `buckets.ts`.

**The live viewport, later the same day.** It shipped without frames and the
card just said "No frames yet." for a whole run, so the pump went back in.

`_viewport_loop` in `sidecar/notice_scraper.py` is the web tool's
`app/main.py` loop, moved to where the session now lives — same 1.5s interval,
same JPEG quality 45, same guard. Nothing in `app/portal/*` was touched (prime
directive 1): `safe_to_capture()` and `page_closed()` were already there, and
the two copies still `diff` clean. `scraper.rs` needed no change either — it
special-cases `notice` and re-emits everything else verbatim, so
`{"ev":"viewport","img":…}` reaches the window as it is.

The credential rule is the reason the loop is written this way and must not be
relaxed: `safe_to_capture()` is false for the whole of `login()` — which is also
the whole of the OTP wait, since `in_login` stays set until the dashboard is
reached — and for two seconds after. So the login screen, the password field and
the OTP box are never photographed. The card draws the lock/phase animation over
that window instead, which is what it was always for. A failed login therefore
emits **zero** frames, by design; that is not the pump being broken.

Lifecycle: the pump starts right after `session.start()` and every path that
ends a session now goes through `Runner._drop_session()`, which cancels the task
*before* stopping the session — otherwise it screenshots a browser being torn
down and the run's last event is a stray traceback.

REC is its own state in the UI, not "is there a frame": the last frame of a
finished run stays on screen under a dark light, exactly as the old CSS
intended (`.monitor.live .rec`). It goes dark on `sync_done`, on
`otp_required`, on a login error and on `exited`.

**Re-freeze the sidecar or none of this happens.** `scraper.rs` runs the frozen
binary (`src-tauri/resources/scraper/`, or `sidecar/dist/` in dev), not the
`.py`. Editing the Python and restarting the app changes nothing until
`sidecar/build.sh` (or `build.ps1`) has run. Done here on 2026-09-07; the
Windows build happens on the CI runner anyway.

Cost: one base64 JPEG per 1.5s over the Tauri IPC channel — order 100–200 KB a
frame on a real portal page. The web tool pushed the same over a websocket. If
it ever competes with a PDF, `VIEWPORT_INTERVAL` and `VIEWPORT_QUALITY` are two
constants at the top of the sidecar.

**The duplicated log lines.** Every line arrived twice. `listen()` resolves a
tick or two after the effect returns, so under StrictMode the cleanup ran while
`unlisten` was still `undefined` and the first listener was never removed — two
listeners, every event handled twice. Fixed with a `dropped` flag the promise
checks. Worth remembering: any `useEffect` that awaits its own unsubscriber has
this bug. The UI also stopped writing its own "Logged in." on `login_ok`, since
`session.py` already logs "Logged in" and the two read as a stutter.

**Saving files.** No dialog/fs plugin is installed and `capabilities/default.json`
grants only `core:default`, so `ui/download.ts` saves through an `<a download>`
on a blob URL — the same trick `XLSX.writeFile` already used for the export. If
Save turns out to be silent in WebView2, the fix is the plugin pair plus a
widened capability, not a change to that file.

**Three lib files are quarantined, not deleted.** `src/lib/ws.ts`,
`src/lib/utils.ts` and `src/lib/files.ts` are kept on disk but listed in
`tsconfig.json`'s `exclude`, because they cannot compile against this tree:
`ws.ts` imports `SpeedMode`/`SyncState` from an `api.ts` that no longer exports
them and talks to a websocket that no longer exists, `utils.ts` wants Tailwind's
`clsx` + `tailwind-merge`, and `files.ts` imports the two Tauri plugins above.
`runtime.ts` and `secrets.ts` do compile (the `@/*` alias is back in
`tsconfig.json`) but nothing imports them either — they address `backend_info`
and `secret_status`, commands `lib.rs` does not have. All five are dead; they
are listed here so deleting them is a one-line decision later.

**Checked, not tested.** `npm run build` is clean (`tsc` + Vite). The screens
were driven in a headless Chromium against a stubbed `__TAURI_INTERNALS__` to
confirm the wiring: login → OTP → `login_ok` fires `portal_speed` then
`portal_sync` with the header's limit; the pipeline, login stage, run log and
last-sync line follow the event stream; the AY / name / missing-due filters and
the bucket chips cut the table to the right counts; the PDF modal opens a blob
URL; Export writes a three-sheet workbook. None of that is the real sidecar, the
real archive or Windows — the human still verifies all three.

Two bugs found and fixed that way, both worth remembering: `startSync` read
`loggedInRef` in the same tick `login_ok` set it, so the auto-sync after a login
bounced straight back to the login card (the ref is now written by hand in that
branch); and the login card stayed on screen behind the OTP card, because it was
only hidden on `login_ok` rather than when the login was sent.
