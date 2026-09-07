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
