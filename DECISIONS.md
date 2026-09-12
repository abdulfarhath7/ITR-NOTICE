# DECISIONS.md

Append-only. One entry per non-obvious choice. Newest at the bottom.

Format:
```
## D-nnn — title
Date: YYYY-MM-DD
Context: what forced a choice
Decision: what was chosen
Rejected: what was not, and why
Reversible: easily / with migration / not really
Related: Qnn if a question was filed
```

---

## D-001 — Single work-item spine instead of per-module table trees
Date: seeded
Context: Scope grew from e-Proceedings alone to four portal modules.
Decision: One `proceedings` table serving assessments, appeals and standalone
letters, with category supplied by a type registry; sibling tables for demands,
returns and filed forms; one polymorphic `documents` store.
Rejected: Four independent table trees — would fork the codebase four ways.
Reversible: with migration.

## D-002 — Ingestion is attended, sequential and resumable
Date: seeded
Context: Portal serialises sessions and requires captcha plus OTP at login.
Decision: One session at a time, a human clears login challenges, the queue
pauses rather than fails, and any run resumes from its last position.
Rejected: Unattended overnight parallel worker pool — cannot clear OTP, and
concurrent sessions for one taxpayer evict each other.
Reversible: not really. Related: Q08, Q09.

## D-003 — Per-device ledger streams, not one global counter
Date: seeded
Context: Both the collector and user devices can write.
Decision: Ledger entries are keyed `(device_id, seq)`. A device cursor is a
map of device_id to last applied seq.
Rejected: Single monotonic counter — two writers would collide.
Reversible: with migration.

## D-004 — Zero-knowledge relay
Date: seeded
Context: Client tax data would sit on a server we operate, for many firms.
Decision: Changesets are sealed on the collector with a firm key that never
leaves firm devices. The relay stores opaque blobs plus routing metadata.
Rejected: Server-side decryption for convenience features.
Reversible: not really, and deliberately so.

## D-005 — Blank beats guessed
Date: seeded
Context: A due date drives a real statutory limitation.
Decision: Missing portal fields are stored NULL with a gap flag and rendered
as "not stated". AI suggestions live in separate columns and require a human
action to be promoted.
Rejected: Inferring dates to make the dashboard look complete.
Reversible: yes, but do not.

## D-006 — Previous-generation docs moved to `docs/legacy/`, not deleted
Date: 2026-09-12
Context: The spec bundle's `docs/01..15` collided with the older
`docs/01..09` set (different numbering, different design). The old
`NOTES.md` and `QUESTIONS.md` (373 and ~300 lines of real history: SQLCipher
key handling, sidecar freeze rules, the first green CI run, sixteen open
questions on updater, signing, install mode) were overwritten by the bundle's
templates.
Decision: `git mv` the old docs into `docs/legacy/` and save the old
`NOTES.md` / `QUESTIONS.md` there as dated files. The reading order in
`CLAUDE.md` now resolves unambiguously.
Rejected: Deleting them — task 0.1 says delete nothing yet, and the legacy
questions (updater, code signing, NSIS mode) are still unanswered and still
matter for Phase 10.
Reversible: easily.

## D-007 — "Year not stated" is a year context with a NULL assessment year
Date: 2026-09-12
Context: The portal issues letters (Issue Letter, Recovery Process, some DRP
rows) that carry no assessment year. The spine requires every proceeding to
hang off a year context, and inventing a year is forbidden.
Decision: `year_contexts.assessment_year` is nullable; each client may have
exactly one such context (partial unique index). It renders as "Year not
stated". The proceeding carries `assessment_year` in `gap_flags`.
Rejected: A sentinel string like `unknown` (pollutes exports and sorts
oddly); a nullable `year_context_id` (breaks "child of one parent").
Reversible: with migration.

## D-008 — Documents are content-addressed blobs inside the encrypted archive
Date: 2026-09-12
Context: `docs/07` wants an encrypted document store; `docs/03` wants
documents deduplicated by hash; the previous build already kept PDFs in the
SQLCipher file.
Decision: `document_blobs(file_hash PK, bytes)` in the same SQLCipher
database; `documents.storage_path` is the locator `blob:<sha256>`. One copy
per hash, encryption inherited, one file to back up.
Rejected: Files on disk under a `documents/<hash>` folder — would need a
second encryption layer and a second backup story.
Reversible: with migration (the locator string is designed for it).

## D-009 — Backfill attaches PAN-less "Self" cards to the login PAN
Date: 2026-09-12
Context: 2 of 28 legacy proceedings printed no PAN. They sit on the "Self"
tab, which by the portal's definition is the logged-in taxpayer's own book.
Decision: The migration uses the PAN most seen on the Self tab, records
`pan` in `gap_flags`, and leaves `verified_flag = 0`. Live ingestion does the
same with the login PAN of the session.
Rejected: Refusing those rows (data loss); a placeholder client (invents an
entity).
Reversible: easily — the gap flag marks every affected row.

## D-010 — A proceeding's due_date is a roll-up of its notices' stated dates
Date: 2026-09-12
Context: The portal prints "Response Due Date" on the notice card, not on the
proceeding card. `proceedings.due_date` in the spec is the portal-stated
response due date.
Decision: `proceedings.due_date` = the earliest `response_due_date` among the
proceeding's still-open communications, recomputed by
`repo::proceedings::refresh_due_date` after every write. NULL, with a gap
flag, when no open communication states one. Never computed from anything
else.
Rejected: Leaving it NULL always (the attention list ranks on it); copying
the latest notice's date regardless of status (a closed notice would keep an
open proceeding "overdue").
Reversible: easily.

## D-011 — A legacy Claude-sourced due date becomes a suggestion
Date: 2026-09-12
Context: The previous build wrote Claude's due date into `notices.due_date`
with `due_date_source = 'claude'`. The spec forbids an AI date in the stated
column.
Decision: The backfill and live intake move such a date to
`proceedings.suggested_due_date` and record `response_due_date` as a gap.
The legacy archive on this machine has no such rows; the rule exists for the
ones that do.
Reversible: yes.
