# 05 · Conventions

## Stack (pin these)
- Tauri **2.x**; Rust stable.
- Node **LTS**; package manager **pnpm**.
- React **18+**, TypeScript **strict**, Vite, Tailwind, shadcn/ui.
- Python **3.11**; PyInstaller for the sidecar.

## Frontend layout
```
src/
  app/           # routing, providers, shell
  features/      # notices, sync, drafts, summary — one folder per screen
  components/ui/ # shadcn primitives
  lib/api.ts     # single typed client for the API in docs/03 (token + base URL)
  lib/ws.ts      # single WebSocket client
```

## Rules
- TypeScript strict; no `any`. All API responses typed in `lib/api.ts`.
- One API client and one WS client — no scattered `fetch()` calls.
- Tailwind tokens only; no hardcoded hex. Calm, two-pane feel; restraint over density.
- No browser storage (localStorage/sessionStorage) for secrets — use the keychain.
- Small, phase-scoped commits: `feat(ui): notices table`, `chore(sidecar): health probe`.

## Do / Don't
| Do | Don't |
|---|---|
| Reuse the backend API verbatim | Rewrite or reformat `app/` |
| Add types for every endpoint | Sprinkle untyped fetches |
| Keep the sidecar on loopback | Expose any port publicly |
| Ask before adding a dependency | Pull in heavy UI kits beyond shadcn |
