# docs/ — context set for the desktop port

Modular context for the agent. Each file has one job. **Load only what the
current task needs** — this keeps context small and precise.

## Reading order
1. `00-overview.md` — what we're building and, more importantly, what we're not.
2. `01-existing-backend.md` — the code you reuse verbatim (the biggest time-saver).
3. `02-architecture.md` — how the pieces fit at runtime.
4. `03-api-contract.md` — the exact interface the UI talks to.
5. `04-build-plan.md` — the phased plan with acceptance gates.
6. `05-conventions.md` / `06-security.md` / `07-ci-release.md` — apply as needed.
7. `08-glossary.md` — reference only.

## Principle
The backend already works and already exposes a clean HTTP+WebSocket API.
The port is a *packaging + UI* job, not a rewrite. When in doubt, reuse.
