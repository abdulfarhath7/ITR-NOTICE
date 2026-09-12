# CLAUDE.md — root control file

Read this file first, in full, before touching any code.
Then read `docs/00-overview.md` and `TASKS.md`.

---

## 1. What you are doing

You are building **Draftax / Notice Desk**: an income tax notice, demand and
compliance management tool for Indian chartered accountancy firms.

The repository already contains partial work (a FastAPI + Playwright web tool
and a Tauri 2 desktop shell). You are extending it, not starting over.
Inspect what exists before you write anything new.

---

## 2. Operating mode — AUTONOMOUS

This is an unattended build. The user is asleep. There is no one to ask.

**Hard rules:**

1. **Never stop to ask a question.** Not once. Not for anything.
2. When you hit a genuine unknown, do all three of these and continue:
   - pick the most defensible option,
   - append an entry to `QUESTIONS.md` using the template in that file,
   - record the decision in `DECISIONS.md`.
3. **Never leave the tree broken.** If a change does not compile or the app
   does not start, fix it or revert it before moving on. A working subset
   beats a broken superset.
4. Work `TASKS.md` top to bottom. Tick each checkbox the moment the task's
   acceptance criteria pass. Do not reorder phases.
5. Commit after each completed task. Conventional commits
   (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
6. Log every error you hit and how you resolved it in `NOTES.md`.
   If you cannot resolve one, leave a `TODO(blocked):` comment at the call
   site, write it in `NOTES.md`, and move to the next task.
7. Do not write tests the user did not ask for beyond what
   `docs/12-testing.md` specifies. The user tests manually.
8. Do not refactor code outside the current task's scope.

**If you run low on context:** update `TASKS.md` and `NOTES.md` first so the
next session can resume cleanly. That is the highest-value thing you can do
with your last tokens.

---

## 3. Decision defaults

When a choice is not specified anywhere in `docs/`, apply these in order:

1. Follow the existing pattern in the repository.
2. Prefer the simpler option that can be extended later.
3. Prefer boring, well-supported libraries over clever ones.
4. Prefer explicit over implicit. No magic.
5. If still undecided, choose the option that is easiest to reverse, and
   file it in `QUESTIONS.md`.

---

## 4. Absolute constraints — never violate

These are not preferences. Breaking one is a build failure.

- **Read-only against the portal.** The scraper never clicks Submit, Respond,
  Appeal, Upload, or Pay. Never. Any code path that could write to the portal
  must not exist yet.
- **Never invent a date.** If the portal does not state a due date or a
  limitation date, store `NULL` and set the gap flag. Never infer, estimate,
  or carry forward. AI-suggested dates go in a separate column and can never
  be promoted without a human action.
- **No credentials in files.** Never write a password, cookie, token, API key
  or certificate into source, config, logs, fixtures, or test data. Not even
  a placeholder that looks real.
- **No secrets in the repo.** If you find one already committed, write it in
  `NOTES.md` under "ROTATE IMMEDIATELY" and do not print its value.
- **Never log PII.** PAN, phone numbers and client names are masked in logs.
- **Child of one parent.** Every document row has exactly one parent object.
- **One writer per stream.** Only the collector lease holder publishes sweep
  changesets. See `docs/04-roles-and-devices.md`.

---

## 5. Repository map

```
app/                  existing FastAPI web tool (kept, becomes dev harness)
src-tauri/            Rust core for the desktop app
src/                  React + TypeScript frontend
sidecar/              Python Playwright ingestion sidecar
relay/                NEW: FastAPI relay service (zero-knowledge sync)
migrations/           NEW: SQL migrations, numbered, forward-only
docs/                 the specification you are building from
```

---

## 6. Reading order for `docs/`

| File | Read when |
|---|---|
| `00-overview.md` | first, always |
| `01-architecture.md` | before any structural work |
| `02-data-model.md` | before any schema or migration work |
| `03-sync-and-ledger.md` | Phase 6 and 7 |
| `04-roles-and-devices.md` | Phase 7 |
| `05-ingestion.md` | Phase 4 and 5 |
| `06-source-interface.md` | Phase 4, and before any ERI work |
| `07-security.md` | any time you touch keys, credentials or the relay |
| `08-api-contract.md` | before adding a command or endpoint |
| `09-ui-spec.md` | any frontend work |
| `10-design-system.md` | any frontend work |
| `11-exports.md` | Phase 8 |
| `12-testing.md` | when a task's acceptance criteria mention tests |
| `13-conventions.md` | before your first commit |
| `14-glossary.md` | whenever a tax term is unfamiliar |
| `15-known-bugs.md` | Phase 2 |

---

## 7. Definition of done for any task

- Acceptance criteria in `TASKS.md` are met.
- The app builds and starts.
- No new compiler or type errors.
- No secret, PAN or phone number added to any tracked file.
- `TASKS.md` checkbox ticked, commit made.
- Any new unknown filed in `QUESTIONS.md`.
