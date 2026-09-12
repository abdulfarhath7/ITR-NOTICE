# 00 — Overview

## What the product is

Desktop software for an Indian chartered accountancy firm that manages tax
matters for many clients (target: 200 per firm).

The Income Tax Department posts notices, demands, filed returns and filed
forms into each taxpayer's own account on `incometax.gov.in`. There is no
firm-level view. A firm with 200 clients must open 200 accounts to find out
what arrived. Deadlines get missed.

This tool collects all of it, stores it locally, and presents one list.

## Who uses it

| Role | Who | What is different about them |
|---|---|---|
| Member | Anyone at the firm | Nothing. Full use of the app. |
| Admin | One person per firm | Can nominate which device collects. That is the only extra power. |

There is no separate build, login or licence tier for the machine that
collects. "Collector" is a device setting, not a user type.

## The four modules

1. **e-Proceedings** — assessments, scrutiny, first appeals, issue letters
2. **Outstanding demands** — amounts payable, the firm's stance, challans
3. **e-Returns filed** — returns with their acknowledgements
4. **e-Forms filed** — statutory forms with their receipts

All four hang off the same spine: client → year → matter → document.

## The two guarantees

These are the product. Everything else is convenience.

1. **Nothing arrives without being noticed.**
2. **Nothing is ever invented.** A missing date is shown as missing.

## Non-goals for this build

- Filing or submitting anything to the portal. Read-only, always.
- Offline litigation workflow (hearing diary, counsel notes, paper filings).
  Deferred to `TASKS.md` Phase 13 (Q13).
- Multi-firm administration. One firm per installation.
- Mobile.

## Current repository state

Partially built: a FastAPI + Playwright web tool that handles e-Proceedings
for a single account, and a Tauri 2 desktop shell with a React frontend and a
Python sidecar. Both work to some degree. Inspect before assuming.

Known defects carried forward are listed in `15-known-bugs.md`.
