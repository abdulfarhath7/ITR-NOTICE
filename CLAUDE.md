# Notice Desk — Desktop · Agent Control File

You are building the **Windows-first Tauri 2 desktop app**. The Rust core owns
the data; a bundled Python child process drives the tax portal; a small hosted
proxy holds the Anthropic key and the prompts. Dev on Linux; ship via GitHub
Actions on `windows-latest`.

> **This file was rewritten on 2026-09-04 to match the code that is actually in
> the tree.** The earlier version described a different design — the whole
> FastAPI backend in `app/` shipped as a loopback HTTP sidecar. That design is
> gone. See "What changed" below before trusting any older wording.

## The shape of the thing

```
Notice Desk.exe
  React UI (WebView2)            src/
    | invoke() + a "scraper" event channel
  Rust core                      src-tauri/src/
    ├── db.rs        SQLCipher archive.db in %APPDATA%\in.noticedesk.app\
    ├── keychain.rs  Windows Credential Manager (archive key, portal password, firm token)
    ├── scraper.rs   spawns the sidecar, JSON lines over stdin/stdout
    └── claude.rs    HTTPS to the firm's proxy, bearer token
  notice_scraper.exe             sidecar/     (Python + Playwright + Chromium)
                                              bundled as bundle.resources
        |  https
  proxy/main.py                  YOUR server  (ANTHROPIC_API_KEY + the prompts)
```

Everything except the proxy runs on the user's PC. No loopback HTTP server, no
websocket, no shared launch token — those all belonged to the old design.

## Prime directives (never violate)
1. **Never regenerate portal selectors.** `sidecar/app/portal/session.py` and
   `sidecar/app/portal/scraper.py` are byte-for-byte the web tool's
   `app/portal/*`. They are battle-tested against incometax.gov.in. Fix them
   only from a real failure, and keep both copies in step.
2. **Prompts and the Anthropic key live in `proxy/` and nowhere else.** The
   desktop app must never contain either. It knows only a base URL and a firm
   bearer token.
3. **The encrypted archive is the record.** Every notice, PDF and draft goes
   into `archive.db` through `db.rs`. The sidecar's own SQLite is a staging
   cache only, and its PDF blobs are scrubbed to a 1-byte marker after handoff.
4. **Windows is the only shipping target.** Tauri bundle = NSIS. Never try to
   cross-compile from Linux: the sidecar is a PyInstaller binary and can only be
   frozen on the OS it runs on.
5. **Secrets go to the OS keychain, never to a file.** `settings.json` holds the
   proxy URL, the last user id and the remember flag — nothing secret.

## What changed (2026-09-04)
| Was | Is |
|---|---|
| `app/` FastAPI service frozen as a loopback sidecar | Rust core; only `app/portal/*` survives, inside `sidecar/` |
| HTTP + WebSocket API on 127.0.0.1 with a launch token | `invoke()` commands + one `scraper` Tauri event |
| Anthropic key on the user's machine | `proxy/` on your server holds the key and the prompts |
| Plain SQLite, `TODO(sqlcipher)` | SQLCipher via `rusqlite` (`bundled-sqlcipher-vendored-openssl`) |
| Tauri updater plugin + signed manifest | No updater. Ship an installer per release (see Q2) |
| pnpm, Tailwind, shadcn/ui | npm, hand-written CSS in `src/styles.css` |
| `externalBin` single-file sidecar | `bundle.resources` folder — PyInstaller `COLLECT`, not `--onefile` |

The legacy web tool (`app/`, `run.sh`, `test_app.py`, `Dockerfile`) is still in
the repo as the reference implementation. It is not built, shipped or imported
by the desktop app.

## Operating mode (AUTONOMOUS)
- **Take no input.** Never ask a question mid-build; pick the sensible default,
  build with it, and record it in `QUESTIONS.md` with a blank `Your answer:`.
- **Never stop mid-pass.** On failure: `TODO` at the site, one line in
  `NOTES.md`, keep going.
- **Do not test.** The human runs the app and does all verification. Letting the
  compiler/bundler finish is building, not testing, and is allowed.

## Worklog (three living files at the repo root)
- **`TASKS.md`** — what exists. Tick `[x]` the moment the artifact exists.
- **`QUESTIONS.md`** — decisions that are the human's to make. Default used,
  options, blank answer line. Pass 2 applies the answers and marks `[RESOLVED]`.
- **`NOTES.md`** — technical log: defaults, gaps, TODOs, what will break first.

## Doc index
| File | Read when |
|---|---|
| `docs/00-overview.md` | Always first. |
| `docs/01-existing-backend.md` | Touching the portal automation. |
| `docs/02-architecture.md` | Wiring UI <-> Rust <-> sidecar <-> proxy. |
| `docs/03-api-contract.md` | Any UI data call, sidecar event, or proxy route. |
| `docs/04-build-plan.md` | What is built and what is left. |
| `docs/05-conventions.md` | Writing any new code. |
| `docs/06-security.md` | Secrets, keychain, encryption, the proxy boundary. |
| `docs/07-ci-release.md` | Packaging, signing, the Windows job. |
| `docs/08-glossary.md` | Domain terms. |
| `docs/09-worklog.md` | TASKS / QUESTIONS / NOTES formats + the two-pass loop. |
