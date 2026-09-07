# Notice Desk — desktop

Income-tax notice tracking for CA firms. Tauri 2 shell, Rust core, React UI, the
tested Playwright automation running as a bundled sidecar. Everything runs on
the user's PC except one thing: the Claude drafting proxy.

```
┌─ Notice Desk.exe ────────────────────────────────────────────────┐
│  React UI (WebView2)                                              │
│      │ invoke / events                                            │
│  Rust core ── SQLCipher archive.db ── Windows Credential Manager  │
│      │ stdin/stdout JSON lines                                    │
│  notice_scraper.exe (Python + Playwright + Chromium, bundled)     │
└──────┬───────────────────────────────────────────────────────────┘
       │ https, bearer token             ┌─────────────────────────┐
       └────────────────────────────────►│ proxy/  (holds API key) │──► Claude
                                         └─────────────────────────┘
```

## What lives where

| Piece | Folder | Runs on |
|---|---|---|
| UI | `src/` | user's PC |
| Rust core: encrypted archive, keychain, sidecar bridge, proxy client | `src-tauri/` | user's PC |
| Portal automation (unchanged from the web tool) | `sidecar/app/portal/` | user's PC |
| Sidecar wrapper (JSON-lines protocol) | `sidecar/notice_scraper.py` | user's PC |
| Claude proxy (API key + prompts) | `proxy/` | **your server** |

## Build on Windows

Prerequisites, once:

1. **Rust** — https://rustup.rs (MSVC toolchain)
2. **Visual Studio Build Tools** with "Desktop development with C++"
3. **Node.js 20+** and **Python 3.12**
4. **WebView2** — already on Windows 10/11; the installer bootstraps it otherwise

Then, in order:

```powershell
# 1. Sidecar: Python + Playwright + Chromium -> src-tauri/resources/scraper/
.\sidecar\build.ps1

# 2. UI deps
npm ci

# 3. Dev loop (hot reload, opens the app)
npm run tauri dev

# 4. Installer
npm run tauri build
#    -> src-tauri\target\release\bundle\nsis\Notice Desk_0.1.0_x64-setup.exe
```

No Windows PC? Push a tag (`git tag v0.1.0 && git push --tags`) and
`.github/workflows/release.yml` builds the installer on GitHub's runner.

## Run the proxy

```bash
cd proxy
cp .env.example .env      # add ANTHROPIC_API_KEY and one FIRM_TOKENS entry per firm
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8787
```

In the app: Settings → drafting service address + firm token.

## Gotchas that will actually bite

- **`PLAYWRIGHT_BROWSERS_PATH=0` must be set before `playwright install`.**
  `build.ps1` does this. It puts Chromium *inside* the playwright package so
  PyInstaller's `collect_all` sweeps it into the bundle. Skip it and the
  installed app will say "Executable doesn't exist" on first login.
- **The sidecar is a folder, not a single exe.** That is why it ships via
  `bundle.resources`, not `externalBin` (which copies one file and would
  separate `notice_scraper.exe` from its `_internal/`). `scraper.rs` looks in
  the resource dir first, then `sidecar/dist/` for `tauri dev`.
- **Program Files is read-only.** The archive, staging db and settings live in
  `%APPDATA%\in.noticedesk.app\`. Never write next to the exe.
- **Losing the Windows user profile loses the archive.** The SQLCipher key is
  in Credential Manager; a backup story means exporting the key too. Say so
  in onboarding.
- **Blank window after `tauri dev`?** Set `app.security.csp` to `null` in
  `tauri.conf.json` to confirm it is the CSP, then re-tighten. The shipped
  policy allows `blob:` frames (the PDF viewer) and Tauri's IPC origin.
- **First `cargo build` takes a while** (SQLCipher + OpenSSL compile from
  source once). Later builds are incremental.
- **Sign the installer** or every CA sees a SmartScreen warning. Any OV/EV
  code-signing cert; set `bundle.windows.certificateThumbprint` in
  `tauri.conf.json` or sign the `.exe` afterwards with `signtool`.

## How a sync flows

1. UI → `portal_login` → Rust spawns `notice_scraper.exe` and writes
   `{"cmd":"login",...}` to its stdin.
2. Sidecar drives the portal. When it needs an OTP it prints
   `{"ev":"otp_required"}`; the UI shows the OTP box; `portal_otp` relays it.
3. `portal_sync` → the sidecar walks e-Proceedings. Each notice it commits
   triggers `events.notice_added()`, which emits `{"ev":"notice", ...,
   "pdf_b64": ...}`.
4. Rust writes the row and PDF into the encrypted archive and tells the UI.
   The sidecar then overwrites its own staging copy of the PDF with a 1-byte
   marker, so the scraper's "already fetched, skip" cache still works while
   no real PDF sits unencrypted on disk.

## Where to change things

- Bucket rules (overdue / due ≤3 / ≤10 …): `src/lib/buckets.ts` — a straight
  port of `report.py`.
- Prompts: `proxy/main.py` only. The desktop app never sees them.
- Portal selectors: `sidecar/app/portal/session.py`, `scraper.py` — same files
  as the web tool; fixes flow both ways.
