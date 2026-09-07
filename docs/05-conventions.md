# 05 · Conventions

## Stack (pin these)
- Tauri **2.x**; Rust stable, edition 2021.
- Node **20+**, package manager **npm** (`package-lock.json` is committed and CI
  runs `npm ci`). pnpm was dropped with the old UI.
- React **18**, TypeScript **strict**, Vite. **No Tailwind, no shadcn** — one
  hand-written stylesheet, `src/styles.css`.
- Python **3.12** for the sidecar; PyInstaller `COLLECT` (never `--onefile`).

## Layout
```
src/
  App.tsx          the whole shell: state, event wiring, layout
  components/      Rail, NoticeList, Drawer, Modals
  lib/api.ts       the only place that calls invoke() or listen()
  lib/types.ts     mirrors the Rust Serialize structs
  lib/buckets.ts   due-date classification, ported from app/report.py
src-tauri/src/     lib.rs + db.rs + keychain.rs + scraper.rs + claude.rs
sidecar/           the Python child process
proxy/             the hosted service
```

## Rules
- TypeScript strict, no `any`. Every command wrapped once in `lib/api.ts`.
- A Rust struct that crosses to TS gets a matching interface in `lib/types.ts` —
  change them together.
- No `localStorage`/`sessionStorage` for anything, secret or not; the archive and
  the keychain are the only stores.
- Nothing reaches the network except `claude.rs`. The UI never makes an HTTP call.
- Never log a password, a token or a key. Not to stdout, not to a file.
- Small, scoped commits: `feat(ui): due-date buckets`, `fix(sidecar): otp relay`.

## Do / Don't
| Do | Don't |
|---|---|
| Keep `sidecar/app/portal/*` identical to `app/portal/*` | Regenerate portal selectors |
| Put prompts and keys in `proxy/` | Ship an API key in the installer |
| Add a Rust command for OS work | Reach for another Tauri plugin |
| Freeze the sidecar on the OS it runs on | Cross-compile from Linux |
