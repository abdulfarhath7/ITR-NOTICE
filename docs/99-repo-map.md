# 99 — Repository map

Written at the start of the Draftax build (Phase 0, task 0.1) against commit
`a724978`. Every top-level entry, one line of purpose, and a verdict:
**live** (built or run by something today), **reference** (kept on purpose,
not built), **dead** (nothing imports or runs it), **scratch** (untracked
local files).

Nothing was deleted in this pass. Dead entries are candidates for removal
once the phase that replaces them is green.

## Top level

| Path | Purpose | Verdict |
|---|---|---|
| `src-tauri/` | Rust core: Tauri 2 shell, SQLCipher archive, keychain, sidecar bridge, proxy client | **live** |
| `src/` | React + TypeScript frontend (Vite), single-screen dashboard | **live** |
| `sidecar/` | Python Playwright ingestion sidecar, JSON-lines over stdio, frozen with PyInstaller | **live** |
| `proxy/` | FastAPI proxy that holds the Anthropic key; `/v1/due-date`, `/v1/draft` | **live** (not deployed) |
| `app/` | The original FastAPI + Playwright web tool. Origin of `sidecar/app/portal/*`, which must stay byte-identical. Not built or shipped. | **reference** |
| `docs/` | The specification (`00`–`15`), this map (`99`), and `docs/legacy/` (previous generation of docs, notes and questions) | **live** |
| `migrations/` | Forward-only numbered SQL, embedded into the Rust core at compile time (task 0.3) | **live** |
| `scripts/` | `check.sh` — build, typecheck, lint for every workspace (task 0.5) | **live** |
| `packaging/` | `make_icons.py` (icon generation, still used by hand); `build_sidecar.py` + `llc-backend.spec` froze the old loopback FastAPI sidecar | **live** / **dead** (see below) |
| `public/` | Static assets served by Vite (`fonts/`) | **live** |
| `index.html` | Vite entry | **live** |
| `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts` | Frontend toolchain | **live** |
| `.github/workflows/release.yml` | Windows-only release job on a `v*` tag: freeze sidecar, `tauri build`, NSIS installer | **live** |
| `CLAUDE.md`, `TASKS.md`, `QUESTIONS.md`, `DECISIONS.md`, `NOTES.md`, `PROMPT.md`, `README.md` | Build control files | **live** |
| `app-icon.png` | Source artwork for `packaging/make_icons.py` | **live** (placeholder art) |
| `requirements.txt`, `run.sh`, `Dockerfile`, `docker-compose.yml`, `run_backend.py`, `test_app.py` | The web tool's own run and deploy scripts, and its test file | **dead** (belong to `app/`) |
| `.env`, `.env.example` | The web tool's env. The desktop app reads no `.env`; the sidecar reads `HEADLESS`/`HOLD_ON_ERROR` from env vars set by Rust | `.env` **scratch** (gitignored); `.env.example` **reference** |
| `data/` | The web tool's local SQLite and PDFs. Gitignored. Holds real client data — never print rows from it. | **scratch** (backfill fixture for task 1.8) |
| `build/`, `dist/`, `node_modules/`, `.venv/`, `__pycache__/` | Build outputs and environments | **scratch** |
| `keep-building.sh`, `keep-building.out`, `build-fix-prompt.md`, `build-progress.log`, `Screenshot*.png` | Leftovers from an earlier autonomous loop | **scratch** (gitignored) |

## Inside the live trees

### `src-tauri/src/`

| File | Verdict | Note |
|---|---|---|
| `main.rs`, `lib.rs` | live | 15 commands, one `scraper` event channel |
| `db.rs` | live | SQLCipher open, legacy schema (`proceedings`, `notices`, `drafts`, `runs`), upserts |
| `scraper.rs` | live | spawns the sidecar, routes `notice` events into the archive |
| `keychain.rs` | live | archive key, portal password, firm token via `keyring` |
| `claude.rs` | live | HTTP client for `proxy/` |
| `secrets.rs`, `sidecar.rs` | **dead** | not declared as modules in `lib.rs`; from the loopback-HTTP design |

### `src/`

| File | Verdict | Note |
|---|---|---|
| `main.tsx`, `App.tsx`, `ui/*` | live | the dashboard |
| `lib/api.ts`, `types.ts`, `buckets.ts`, `summary.ts`, `format.ts`, `exportXlsx.ts` | live | |
| `lib/ws.ts`, `lib/utils.ts`, `lib/files.ts` | **dead** | excluded in `tsconfig.json`; cannot compile against this tree |
| `lib/runtime.ts`, `lib/secrets.ts` | **dead** | compile, but nothing imports them and they call commands that do not exist |

### `sidecar/`

| File | Verdict | Note |
|---|---|---|
| `notice_scraper.py` | live | the stdio protocol wrapper |
| `app/portal/session.py`, `app/portal/scraper.py` | live | byte-identical to `app/portal/*` (verified with `diff -r`) |
| `app/db.py` | live | staging cache only; the Rust archive is the record |
| `app/config.py` | live | `HEADLESS`, `HOLD_ON_ERROR`, `DEBUG_DIR` |
| `build.sh`, `build.ps1`, `notice_scraper.spec`, `requirements.txt` | live | freeze scripts; `requirements.txt` is unpinned (legacy Q8) |
| `dist/`, `build/` | scratch | frozen output, gitignored |

### `packaging/`

| File | Verdict |
|---|---|
| `make_icons.py` | live (run by hand) |
| `build_sidecar.py`, `llc-backend.spec` | **dead** — froze the FastAPI loopback sidecar; CI calls `sidecar/build.ps1` instead |

## What runs today

- The desktop app opens, creates or unlocks `archive.db` under the OS app-data
  dir, and shows the dashboard.
- Connect → OTP → Sync drives a real browser through e-Proceedings (Self /
  Other PAN / AR × Action / Information), stores each notice with its PDF.
- Ask Claude for a due date, draft a reply — through `proxy/` if a firm token
  is configured.
- Excel export from the browser side.

## What does not exist yet

`relay/`, a client registry, year contexts, a type registry, a ledger, a job
queue, per-client locks, captcha handling, migrations (before task 0.3), a CI
check script, a pre-commit secret hook.

## Build and run on this machine (task 0.2)

Verified 2026-09-12 on Linux (Wayland), node 22, cargo 1.98, python 3.12 in
`.venv`.

```sh
# one-time: freeze the sidecar so `tauri dev` can find it in sidecar/dist/
(cd sidecar && ./build.sh)          # build.ps1 on Windows

# every time
npm ci                              # or npm install
npm run tauri dev                   # vite on :1420, then cargo run
```

`npm run tauri dev` compiled the Rust core in 17.5 s (warm cache; the first
build compiles SQLCipher and OpenSSL and takes many minutes) and produced a
running `target/debug/llc` window.

Checks without launching a window:

```sh
npm run build                       # tsc + vite build
(cd src-tauri && cargo check)
./scripts/check.sh                  # all of the above plus lint (task 0.5)
```

Release builds happen only in CI on Windows (`.github/workflows/release.yml`).
Never cross-compile the sidecar from Linux.
