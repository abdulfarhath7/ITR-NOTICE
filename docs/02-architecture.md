# 02 · Architecture

```
Notice Desk.exe (Tauri 2, WebView2, NSIS-installed)
  │
  ├── React + TS UI            src/          invoke() + one "scraper" event
  │
  ├── Rust core                src-tauri/src/
  │     ├── lib.rs        commands, settings.json, app state
  │     ├── db.rs         SQLCipher archive.db  ── %APPDATA%\in.noticedesk.app\
  │     ├── keychain.rs   Windows Credential Manager
  │     ├── scraper.rs    child process, JSON lines over stdin/stdout
  │     └── claude.rs     HTTPS to the firm's proxy
  │
  └── notice_scraper.exe       sidecar/      Python + Playwright + Chromium
                                             staging.db + debug/ in app-data
        │ https, bearer token
        ▼
   proxy/main.py                YOUR server   ANTHROPIC_API_KEY + the prompts
```

## Process model
- One window, one Rust process, at most one sidecar child.
- The sidecar is spawned lazily, on the first `portal_login`, and dropped by
  `portal_stop` or when the app exits (`kill_on_drop`).
- No HTTP server anywhere on the user's machine. No websocket. No launch token.

## Data flow for one notice
1. `run_sync` commits a row to the staging SQLite and calls
   `events.notice_added(ref_id)`.
2. `notice_scraper.py` reads the row, emits
   `{"ev":"notice", ...row..., "pdf_b64":...}`, then overwrites the staging blob
   with a 1-byte marker.
3. `scraper.rs` decodes the PDF and calls `db::absorb_notice`, which upserts the
   proceeding and the notice into the encrypted archive.
4. Rust emits `{"ev":"notice","ref_id":...}` to the UI, which reloads the list.

## Where files live
| What | Where |
|---|---|
| Encrypted archive | `%APPDATA%\in.noticedesk.app\archive.db` |
| Scraper staging cache | `%APPDATA%\in.noticedesk.app\staging.db` |
| Failure screenshots | `%APPDATA%\in.noticedesk.app\debug\` |
| Non-secret settings | `%APPDATA%\in.noticedesk.app\settings.json` |
| Secrets | Windows Credential Manager, service `in.noticedesk.app` |
| The sidecar | inside the install directory, under `resources\scraper\` |

Never write next to the executable — Program Files is read-only.

## Chromium
Bundled, not downloaded. `PLAYWRIGHT_BROWSERS_PATH=0` at build time installs the
browser inside the playwright package so PyInstaller collects it. This makes the
installer large and the first run offline-capable.
