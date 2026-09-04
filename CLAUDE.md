# Notice Desk — Desktop Port · Agent Control File

You are building the **Windows-first Tauri 2 desktop** version of this app by
**reusing the existing Python backend unchanged as a bundled sidecar** and
**rebuilding only the UI in React + TS**. Dev on Linux; ship via GitHub Actions.

## Prime directives (never violate)
1. **Do not rewrite, refactor, or reformat `app/`** (the Python backend). It is
   battle-tested: portal selectors, OTP relay, DB schema, Claude prompts. You
   only *wrap and ship* it. Allowed edits are the whitelist in
   `docs/01-existing-backend.md` — nothing else.
2. **Build only three things:** the React UI, the Tauri shell + sidecar wiring,
   and the CI/release pipeline.
3. **Windows is the only shipping target for now.** Tauri bundle = NSIS.
4. **Loopback only.** Sidecar binds `127.0.0.1`, guarded by a shared token.
   Never bind `0.0.0.0`. Never log secrets.
5. **Run autonomously, end to end** (see Operating mode).

## Operating mode (AUTONOMOUS — read carefully)
- **Take no input, ever.** Never ask the user a question or wait for a decision
  mid-build. Instead, use the deferred-questions mechanism below.
- **Never stop.** Build every phase 0→6 in one continuous pass; do not pause for
  review. Keep going until the whole app + CI exist, then commit and stop.
- **Do not test anything.** No tests written or run, no launching the app, no
  verifying flows — the human does ALL testing. Letting the compiler/bundler
  finish (so code is valid) is "building", not "testing", and is allowed.
- **Push through errors.** On failure: `TODO` at the site, one line in
  `NOTES.md`, keep building the rest. Never halt the whole run for one break.

## Worklog + questions (THREE living files at repo root)
Maintain these continuously as you build:
- **`TASKS.md`** — the phase-by-phase checklist (template already provided).
  Tick `[x]` the instant a task's artifact exists. This is the human's progress view.
- **`QUESTIONS.md`** — whenever something is genuinely the human's call (a
  product/UX/policy choice, a value only they know), DO NOT ask and DO NOT stop:
  pick the sensible default, **build with it**, and append a QUESTIONS.md entry
  recording the question, why it matters, the default you used, and options.
  Leave a blank `Your answer:` line.
- **`NOTES.md`** — technical TODOs, known gaps, and errors you pushed through.
Format spec + rules: `docs/09-worklog.md`.

## Two-pass loop
- **Pass 1:** build everything on defaults; fill TASKS.md and QUESTIONS.md; commit; stop.
- The human answers QUESTIONS.md.
- **Pass 2 (re-run):** re-read QUESTIONS.md, apply every answered question,
  rebuild ONLY the parts those answers change, update TASKS.md ticks, mark each
  answered question `[RESOLVED]`, commit, stop. Repeat for any later answers.

## Context economy
- Trust these docs. Do not re-scan `app/` to re-derive what `docs/01` states.
  Load only the doc(s) a task needs (`docs/README.md`).

## Doc index
| File | Read when |
|---|---|
| `docs/00-overview.md` | Always first. |
| `docs/01-existing-backend.md` | Touching/wrapping the backend. |
| `docs/02-architecture.md` | Wiring shell <-> sidecar <-> UI. |
| `docs/03-api-contract.md` | Building any UI screen/data call. |
| `docs/04-build-plan.md` | The continuous build order. |
| `docs/05-conventions.md` | Writing any new code. |
| `docs/06-security.md` | Secrets, keychain, network, storage. |
| `docs/07-ci-release.md` | Packaging, signing, updates, CI. |
| `docs/08-glossary.md` | Domain terms. |
| `docs/09-worklog.md` | TASKS / QUESTIONS / NOTES formats + two-pass loop. |
