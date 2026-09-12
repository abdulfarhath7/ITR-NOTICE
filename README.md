# Litigation Command Center

Income tax notice, demand and compliance tracking for an Indian chartered
accountancy firm. Reads every client's e-Proceedings, outstanding demands,
filed returns and filed forms from the income tax portal — read-only,
always — into one encrypted local book, ranks what needs attention, and
syncs between the firm's devices through a zero-knowledge relay or an
encrypted file bundle.

Two guarantees: nothing arrives without being noticed, and nothing is ever
invented — a date the portal does not state is shown as not stated.

## Run it

```sh
(cd sidecar && ./build.sh)      # once: freeze the Playwright sidecar (build.ps1 on Windows)
npm ci
npm run tauri dev               # the desktop app
./scripts/check.sh              # build, typecheck, lint, tests for every workspace
```

The relay: `uvicorn relay.main:app --port 8790` (see `relay/README.md`).
The drafting proxy: `proxy/main.py`.

## Where to read

- `docs/USER-GUIDE.md` — for the people using it.
- `docs/00-overview.md` onward — the specification this was built from.
- `docs/99-repo-map.md` — what is where.
- `TASKS.md`, `NOTES.md`, `QUESTIONS.md`, `DECISIONS.md` — the build's own
  record: what is done, what was learned, what needs an answer, and why
  things are the way they are.
- `docs/SMOKE.md` — the manual checklist after any significant change.
