# 02 · Target architecture

```
Tauri 2 window  (native, signed, auto-updating)
  |
  |-- React + TS + Tailwind + shadcn  (bundled as Tauri assets)
  |        |  HTTP + WebSocket over loopback, with shared token
  |        v
  |     Python sidecar = existing uvicorn app  (127.0.0.1:<port>)
  |            |
  |            |-- Playwright (drives incometax.gov.in; human OTP in-loop)
  |            |-- SQLite (+ SQLCipher)  — notices, PDFs as blobs, drafts, runs
  |            \-- Claude (Sonnet)       — due dates + draft replies
```

## Frontend delivery pattern
- The React app is **bundled by Tauri** (served via the `tauri://` asset
  protocol), so the updater can update the UI and the UI can call Tauri JS APIs
  (keychain, etc.).
- The sidecar is **API-only** here. Enable CORS for the Tauri origin +
  `127.0.0.1`. Require a shared token (generated at launch, injected into both
  sidecar env and the UI) on every request.

## Sidecar lifecycle (owned by the Rust/Tauri layer)
1. On app start: pick a free loopback port; generate a random token; spawn the
   `notice-desk-backend` sidecar with `HOST`, `PORT`, `APP_TOKEN` in env.
2. Poll `GET /health` until ready (timeout → surface a clear error), then show
   the window.
3. On app exit / crash: terminate the sidecar. Never leave it orphaned.

## Playwright browser
Do NOT bundle Chromium into the installer. On first run, the sidecar runs
`playwright install chromium` into an app-data dir; subsequent runs reuse it.
