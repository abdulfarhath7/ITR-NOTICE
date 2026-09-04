# NOTES — desktop port, pass 1

Technical log for the human who tests this. Defaults chosen, gaps left, and the
places most likely to break first.

Nothing in this pass was run or tested (per `CLAUDE.md` → Operating mode). The
code was written to compile; the human verifies.

## Before it will start at all
```bash
# Linux dev box only - Tauri's own windowing crate needs these, and cargo
# cannot be checked here without them (this machine has neither):
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libdbus-1-dev \
                 libayatana-appindicator3-dev librsvg2-dev pkg-config

npm install -g pnpm          # pnpm is pinned by docs/05 and is not installed here
pnpm install
pip install -r requirements.txt pyinstaller
python packaging/build_sidecar.py     # writes src-tauri/binaries/notice-desk-backend-<triple>
pnpm tauri dev
```
`pnpm tauri dev` will not start without that sidecar binary: `externalBin`
resolution fails before the window opens. There is no lockfile yet — the first
`pnpm install` writes `pnpm-lock.yaml`, and CI uses `--frozen-lockfile`, so
commit the lockfile before the first tag. (`node_modules/` here was installed
with plain `npm` only to run `tsc` and `vite build` over the new code —
`package-lock.json` is gitignored so it cannot be mistaken for the real
lockfile.)

## What was actually compiled
- `tsc -p tsconfig.json` — clean, TypeScript strict, no `any`.
- `vite build` — bundles (`dist/`, ~306 kB JS / 24 kB CSS before gzip).
- `cargo check` in `src-tauri/` — **could not run**: no `glib-2.0`/`dbus-1`
  development headers on this machine, and no `rustup` (so no Windows target
  either). The Rust was instead read against the vendored crate sources under
  `~/.cargo/registry/` — every API, trait import and closure signature checked
  by hand. It has never been compiled. Expect the first `cargo build` to be
  where real errors appear.
Nothing was *run*: no app launched, no sync attempted, no test written.

## Backend edits (the whole whitelist, nothing else)
`app/main.py` only:
- `GET /health` → `{"ok": true}`, exempt from both gates.
- `CORSMiddleware` for `tauri://localhost`, `http(s)://tauri.localhost` and a
  regex for loopback. Never a public origin.
- `APP_TOKEN` from the environment. A request carrying it (header
  `X-App-Token`, or `?token=` for the websocket, which cannot carry a header)
  is authorised without the dashboard cookie. With `APP_TOKEN` unset the web
  deployment behaves exactly as before.

Two things in that gate are worth knowing, because both were wrong in the first
draft and are the kind of thing that only shows up in use:
- **The token stands on its own.** It is checked *before* the old
  `if not settings.app_password: everything is open` shortcut. Without that, a
  desktop install — which sets no `APP_PASSWORD` by default — would have run a
  completely unauthenticated server on loopback, which is the opposite of what
  the token is for.
- **`OPTIONS` is let through.** Starlette builds its middleware stack in
  reverse registration order, so the password middleware ends up *outside*
  `CORSMiddleware`. A CORS preflight carries neither cookie nor token by
  definition, so without the bypass every cross-origin call from the window
  would be answered `401` with no CORS headers and the browser would block the
  real request.
- HTTP does **not** honour `?token=` (only the websocket does), and
  `run_backend.py` installs a logging filter that rewrites `token=…` out of
  uvicorn's log lines. The Rust side scrubs the same pattern out of anything
  the sidecar prints.

`app/db.py`, `app/portal/*`, `app/claude_client.py`, `app/report.py` are
untouched.

## Sidecar
- `run_backend.py` is the entry point, frozen by PyInstaller into
  `notice-desk-backend`. It repoints `db.DB_PATH` at the OS app-data directory
  **from outside** `app/` — a one-file bundle unpacks into a temp dir that
  disappears on exit, so the shipped database would otherwise be lost every
  run. In plain `python run_backend.py` development it keeps using `./data`.
- Chromium is not bundled. On first run the sidecar sets
  `PLAYWRIGHT_BROWSERS_PATH` under app-data and runs `playwright install
  chromium`. **Most fragile part of the build.** The frozen binary re-runs
  *itself* with `NOTICE_DESK_PLAYWRIGHT_CLI=1` to reach playwright's CLI,
  because there is no interpreter to re-enter.
  - The download runs on a **background thread**, after uvicorn binds. It is a
    ~150 MB fetch and would otherwise sit in front of the port, and the shell
    gives up on `/health` after 45s. So the window opens straight away and a
    sync started during that first minute fails with a plain playwright error.
  - "Already installed" is decided by playwright's own `INSTALLATION_COMPLETE`
    marker, not by the folder's existence, so an interrupted first install is
    retried instead of trusted.
  - If Chromium never appears, every screen still works except a sync; watch
    the log for `[sidecar] Chromium install failed`.
- The bundle carries `app/static`. `app/main.py` mounts it at import time, so
  without it in `datas` the frozen sidecar dies before it binds anything.
- `DEBUG_DIR` is repointed at app-data too, or the screenshot a failed run
  leaves behind would be written into the temp dir that disappears with the
  process.
- The shell picks a free loopback port (`bind :0`), mints a 48-char token per
  launch, and polls `/health` for 45s before showing the window. It requires
  the documented `{"ok":true}` body, not merely a 2xx, so a stranger that
  grabbed the port between `bind :0` and the child's own bind is never handed
  the token. If the child dies first, the wait fails at once instead of
  counting out the timeout.
- Whatever way the app exits — window destroyed, exit requested — the child is
  killed. A second launch focuses the existing window
  (`tauri-plugin-single-instance`) rather than starting a second sidecar
  against the same database.
- Why a start-up failed reaches the UI two ways: an event, and the
  `backend_info` command's error. The event alone raced the webview's listener
  and could be missed entirely.
- `tauri-plugin-log` writes to the OS log dir. Without it every `log::` call in
  the shell — including the whole sidecar transcript — went nowhere, which is
  exactly the diagnostic needed for the Chromium path above.

## Secrets
- OS keychain via the `keyring` crate (Windows Credential Manager on the
  shipping target). Slots: `app_password`, `llm_key`, `portal_user_id`,
  `portal_password`.
- **Default is to store nothing.** Only `APP_PASSWORD` and `ANTHROPIC_API_KEY`
  are ever injected into the sidecar's environment, and only if the user filled
  them in the Stored-secrets dialog. The portal login stays typed-in and
  memory-only, which is what the backend was built around.
- A secret change takes effect at the next app start (injection happens at
  spawn). The dialog says so.

## Known gaps / TODO
- `TODO(sqlcipher)` in `run_backend.py`: the archive is still plain SQLite.
  Encrypting it means swapping the driver under `app/db.py` and issuing
  `PRAGMA key` on every connection — a change inside `app/`, which this port is
  not allowed to make, and `pysqlcipher3` has no Windows wheel. Deferred per
  `docs/04` Phase 4.
- `src-tauri/tauri.conf.json` ships placeholders that must be replaced before a
  release: `plugins.updater.pubkey` (`REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`)
  and the endpoint URL (`OWNER/REPO`). Generate with
  `pnpm tauri signer generate -w ~/.tauri/notice-desk.key`; the private key and
  its password become the `TAURI_SIGNING_PRIVATE_KEY` secrets.
- The `fs` capability is scoped to `$HOME/**` (plus `$DOWNLOAD`, `$DOCUMENT`,
  `$DESKTOP`), denying `$HOME/.ssh` and `$APPDATA`. Writes only ever happen to
  a path the user picked in the native save dialog, so this is still broader
  than the use; a save outside the home tree will be refused.
- Dependency versions are **not pinned**. CI installs `requirements.lock.txt`
  when it exists and warns loudly when it does not. Generate it with
  `pip freeze > requirements.lock.txt` on a machine where the backend is known
  good — deliberately not invented here, because guessing versions for a
  battle-tested backend is worse than leaving it unpinned (see Q8).
- App icons are placeholder artwork generated by `packaging/make_icons.py`.
- `app/static/` is left in place: the sidecar still mounts it at `/`, so the old
  web dashboard remains reachable on the loopback port. Harmless, and useful
  for comparing behaviour side by side.
- No `.icns`/macOS or Linux bundle targets. Windows/NSIS only, per `docs/00`.
- The `/` shortcut finds the notices name filter by its `data-filter="name"`
  attribute rather than a ref, because the table owns its own filter row. If
  that attribute is ever renamed the key silently stops working.

## Verification checklist for the human
1. `python packaging/build_sidecar.py` then run the binary directly:
   `APP_TOKEN=x PORT=8123 ./src-tauri/binaries/notice-desk-backend-*` and
   `curl 127.0.0.1:8123/health`.
2. `pnpm tauri dev` — the window should appear only after `/health` answers.
3. Sync with the browser visible (`HEADLESS=false` in `.env`) and confirm the
   viewport frames, the OTP freeze and the Slow/Fast/Extreme buttons mid-run.
4. Kill the app from the taskbar and confirm no `notice-desk-backend` process
   survives.

## What the audit changed
After the first draft was written, 5 reviewers went over the shell, the
packaging, the backend edits, the frontend core and CI; every claimed defect
was then put to two independent skeptics. 31 claims, 27 survived, all applied.
The ones that would have stopped the app dead:
1. The launch token was not enforced unless `APP_PASSWORD` was also set — a
   default install ran an open server on loopback.
2. CORS preflights were answered `401` by the outer password middleware, so
   every API call from the window would have been blocked by the browser.
3. `app/static` was missing from the PyInstaller bundle, so the frozen sidecar
   would have crashed at import, before binding.
4. The first-run Chromium download sat in front of the port bind, guaranteeing
   a `/health` timeout on every fresh install.
5. Nothing in CI actually Authenticode-signed anything, and nothing in the app
   ever called the updater.

## First real run on Linux (dev host)
The sidecar was frozen and `pnpm tauri dev` was run end to end on the dev
machine. Four things had to be fixed before the window came up; all four are
recorded here because three of them would have bitten the Windows CI job too.

1. **The repo's own `packaging/` directory shadowed the PyPI `packaging`
   package.** `build_sidecar.py` put the repo root on `PYTHONPATH` so the spec
   could import `app`, and PyInstaller then died on
   `ModuleNotFoundError: No module named 'packaging.requirements'`. The
   `PYTHONPATH` entry is gone; the build now passes `PYTHONSAFEPATH=1` and
   relies on the spec's `pathex` to find `app`. This one is platform
   independent — CI would have hit it identically.
2. **`error[E0597]` in `sidecar.rs`.** On edition 2021 the `MutexGuard`
   temporary from `if let Ok(mut guard) = state.child.lock()` lives to the end
   of the enclosing block, i.e. past the `state` local it borrows. Fixed by
   borrowing the handle inline instead of binding it.
3. **Every log line appeared twice.** `tauri_plugin_log`'s `.target()` appends
   to the plugin's default targets, which already include a stdout writer, so
   the added `Stderr` target was a second copy. `.targets([...])` replaces
   instead.
4. **The updater logged an ERROR on every dev launch**, because
   `tauri.conf.json` still carries the `OWNER/REPO` placeholder feed (Q2). The
   check is now skipped when `import.meta.env.DEV`.

Verified on this host after the fixes:
- the frozen binary answers `/health` in about a second;
- its bundled Playwright driver reports `Version 1.62.0` and really launches
  Chromium (`screenshot https://example.com` produced a PNG), so the freeze
  fear this file recorded is not borne out on Linux — Windows is still untested;
- `pnpm tauri dev` starts the shell, spawns the sidecar on a loopback port,
  downloads Chromium (184 MB) into
  `~/.local/share/com.noticedesk.app/browsers/`, and the window's websocket
  connects with the token redacted in the log.

Two further defects the run exposed, both fixed:

5. **Orphaned sidecars.** `SidecarState::shutdown()` only runs on the graceful
   window-close path, so every `tauri dev` rebuild left the previous
   `notice-desk-backend` alive, holding the database and a loopback port; five
   had piled up. The sidecar now watches the shell's pid
   (`NOTICE_DESK_SHELL_PID`, set at spawn) and exits when it disappears. Note
   for anyone tempted to simplify it: watching stdin for EOF instead does *not*
   work - the shell does not give the sidecar a private stdin pipe, and the
   first attempt at this survived a `kill -9` of the shell untouched. Two more
   traps on the way to a version that actually fires: a killed shell nobody has
   reaped is a zombie, and signal 0 still reaches it (so the watcher reads
   `/proc/<pid>/stat` and treats state `Z` as gone), and the watcher's own
   "shell is gone" print raises `BrokenPipeError` - stdout *is* the dead
   shell - which killed the thread before it reached `os._exit`. Verified by
   `kill -9` on the running app: no `notice-desk-backend` survives.
6. **A surviving app process blocks every later launch, silently.** The app
   outlives `pnpm tauri dev` when that wrapper is killed, and it keeps the
   `com.noticedesk.app.SingleInstance` DBus name, so the next `tauri dev` exits
   0 with no output at all - it looks exactly like a crash. If a dev launch
   ever ends instantly and prints nothing, look for a live `notice-desk`
   process first. (5 makes the sidecar half of this self-cleaning; the shell
   half is inherent to the single-instance plugin.)

Two things the dev host needed that a clean machine will too: the venv was
created without `ensurepip`, so `pip` had to be bootstrapped from the system
copy, and `packaging`/`setuptools` are not pulled in automatically when pip can
see a system `packaging` — install them into the venv explicitly.
