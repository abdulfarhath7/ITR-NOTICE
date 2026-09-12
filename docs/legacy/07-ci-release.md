# 07 · CI & release

One job: `.github/workflows/release.yml`, `windows-latest`, triggered by a
`vX.Y.Z` tag or run by hand from the Actions tab.

## Flow
1. Check the tag equals `v` + `version` in `tauri.conf.json`; fail early if not.
2. Python 3.12 → `sidecar/build.ps1`: venv, `PLAYWRIGHT_BROWSERS_PATH=0`,
   `playwright install chromium`, PyInstaller, copy `dist/notice_scraper` to
   `src-tauri/resources/scraper`. Fail if `notice_scraper.exe` is not there.
3. Node 20 → `npm ci`.
4. Optional: import `WINDOWS_CERT` (base64 PFX) into the runner's certificate
   store and write its thumbprint into `tauri.conf.json`. Skipped when the
   secret is empty; nothing is echoed.
5. `tauri-action` → `npm run tauri build` → NSIS installer → draft release.
6. Upload the installer as a build artifact too.

**Never cross-compile from Linux.** The sidecar is a PyInstaller binary; a
Windows executable can only be frozen on Windows.

## Secrets
- `WINDOWS_CERT` / `WINDOWS_CERT_PASSWORD` — Authenticode. Without them the
  installer still builds, unsigned, and SmartScreen warns every user.
- No updater secrets. There is no updater (QUESTIONS.md Q2). If one is added
  later, its key and feed URL must exist *before* the first public installer —
  a machine can only be updated by a build that already knew where to look.

## Dependency pinning
CI installs `sidecar/requirements.lock.txt` when it exists and prints a loud
warning when it does not. Generate it with
`pip freeze > sidecar/requirements.lock.txt` on a machine where a sync is known
to work — not by guessing versions (QUESTIONS.md Q8).

## Dev vs release
- Dev: Linux or Windows, `npm run tauri dev`. Needs the sidecar built once
  (`sidecar/build.sh` / `build.ps1`); `scraper.rs` finds it in `sidecar/dist/`.
- Release: this job only, on a tag.
