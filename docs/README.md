# docs/ — context set for Notice Desk

Modular context for the agent. Each file has one job. **Load only what the
current task needs.**

Rewritten 2026-09-04 for the current design: a Rust core that owns the data, a
Python child process that drives the portal, and a hosted proxy that holds the
Anthropic key. The earlier set described shipping the whole FastAPI backend as
a loopback HTTP sidecar — that is gone.

## Reading order
1. `00-overview.md` — what this is, and what it is not.
2. `01-existing-backend.md` — the portal automation reused verbatim.
3. `02-architecture.md` — how the pieces fit at runtime.
4. `03-api-contract.md` — commands, events, and the proxy's routes.
5. `04-build-plan.md` — what exists and what is left.
6. `05-conventions.md` / `06-security.md` / `07-ci-release.md` — apply as needed.
7. `08-glossary.md` — reference only.

## Principle
The portal automation is the expensive part and it already works. Everything
else — the archive, the UI, the packaging — is ours to shape. When in doubt,
leave the automation alone.
