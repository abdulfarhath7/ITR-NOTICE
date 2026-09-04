# 07 · CI & release (GitHub Actions, Windows)

## Runner & flow
- Runner: `windows-latest` (never cross-compile the Windows target from Linux).
- Steps:
  1. Set up Python 3.11 + install backend deps + `playwright install --with-deps chromium`
     as needed for the build; build the sidecar with PyInstaller
     (`--onefile -n notice-desk-backend`).
  2. Set up Node LTS + pnpm; `pnpm install`.
  3. `tauri-action` runs `pnpm tauri build` → `.exe` + **NSIS** installer.
  4. Code-sign with the Windows signing cert (from repo secrets).
  5. Upload artifacts; publish the updater manifest to the static feed.

## Secrets (GitHub → repo settings)
- `WINDOWS_CERT` / `WINDOWS_CERT_PASSWORD` (code signing).
- `TAURI_SIGNING_PRIVATE_KEY` / password (updater signature — separate from
  code signing).
- Never echo secrets in logs.

## Dev vs release
- Local dev: Linux, `pnpm tauri dev` (spawns the sidecar too).
- Release builds: only via this Windows CI job on tag push.

## Updater
- Static manifest (JSON) + signed artifacts. Updates swap in place; no reinstall.
- First install = NSIS installer; every update after is silent.
