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
  styles.css       byte-for-byte app/static/style.css - do not hand-edit
  ui/              one file per section of the old dashboard:
                   Header, Gates, Overview, Watch, Report, Notices,
                   Viewer, DraftDrawer, Palette, Settings, Toast
  lib/api.ts       the only place that calls invoke() or listen()
  lib/types.ts     mirrors the Rust Serialize structs
  lib/buckets.ts   due-date classification, ported from app/report.py
  lib/summary.ts   the report's counts, ported from app/report.py
public/fonts/      Geist + Geist Mono, at the path styles.css asks for
src-tauri/src/     lib.rs + db.rs + keychain.rs + scraper.rs + claude.rs
sidecar/           the Python child process
proxy/             the hosted service
```

## Rules
- TypeScript strict, no `any`. Every command wrapped once in `lib/api.ts`.
- A Rust struct that crosses to TS gets a matching interface in `lib/types.ts` —
  change them together.
- No `localStorage`/`sessionStorage` for **anything the app is answerable for**:
  notices, PDFs, drafts and every secret live in the archive and the keychain,
  which are the only stores of record. Two display conveniences are the whole
  exception, and both are disposable: `notice-desk.theme` and
  `notice-desk.last-run` (the "Last sync …" line — see QUESTIONS Q15). Losing
  either costs a preference and a sentence, nothing more.
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
