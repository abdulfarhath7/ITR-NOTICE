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

## D-012 — Display name "Draftax"; bundle identifier unchanged
Date: 2026-09-12
Context: The spec bundle names the product Draftax (Q19 default) while the
tree had been renamed to "Litigation Command Center" four days earlier.
Decision: The window title, sidebar and export header say Draftax, held in
one constant (`src/lib/product.ts`, `tauri.conf.json`). The Tauri identifier
`in.llc.app`, the Cargo/npm package names and the keychain service name are
untouched: changing the identifier orphans every installed archive and its
key (legacy Q16). Filed as Q21.
Reversible: easily for the display name; the identifier deliberately not.

## D-013 — Low parse confidence is audited per panel, not stored per row
Date: 2026-09-12
Context: Task 4.6 asks for a per-field confidence flag. Every machine-read
row already starts at `verified_flag = 0`, and `gap_flags` means "the portal
did not show it", which is a different fact from "read it loosely".
Decision: The sidecar reports a confidence map per header. The runner keeps
the value, leaves `verified_flag = 0`, and writes the low-confidence field
counts into `ingestion_runs.gaps` for that panel, where the sweep history
shows them. Rows carry no third flag.
Rejected: A `low_confidence` column on every table (schema churn for an
audit fact); putting `?field` markers into `gap_flags` (would render as
"not stated" for a value that was stated).
Reversible: easily.

## D-014 — One ingestion job per login, not per client
Date: 2026-09-12
Context: TASKS 4.2 says one job per client per module. Clients reached
through an Authorised Representative login share that login's panels: one
session lists all of them, attributed by the PAN on each card.
Decision: `ingestion_jobs` is keyed by `login_ref` (own PAN or
`portal_login_ref`) and module. A client with its own credentials is still
exactly one job; AR-reached clients ride the AR login's job.
Rejected: A job per AR-reached client, which would log into the same
account several times in one run and evict its own session.
Reversible: easily.

## D-015 — The sidecar holds no state; the core decides what to fetch
Date: 2026-09-12
Context: The pre-build scraper kept its own staging SQLite as a cache. The
spec forbids the sidecar touching a database and puts the early-stop streak
and change detection on row hashes the core owns.
Decision: A header/verdict handshake over stdio. The sidecar reads a card,
emits it, and waits; the core hashes it against what is stored and answers
skip, fetch or stop. Fetch returns the PDF in the same stream. Pausing holds
the next verdict, so the browser simply waits on its list page.
Rejected: Sending the known-hash set to the sidecar (two hash
implementations to keep identical).
Reversible: with a protocol change.

## D-016 — Snapshots are JSON, not a second SQLite file
Date: 2026-09-12
Context: docs/03 sketches `snapshot.sqlite` inside a bundle.
Decision: The snapshot is `snapshot.json`: every synced table's rows as the
same JSON payloads the ledger carries, plus `entity_versions` and the cursor
map. Loading one is the same merge as applying entries.
Rejected: A compacted SQLite file — a second schema to keep in step with
migrations, and a plaintext database inside an archive that would need its
own SQLCipher key handling.
Reversible: easily; the bundle is versioned (`format`).

## D-017 — Duplicate identities converge on the smaller id
Date: 2026-09-12
Context: Two devices can create the same client (or year context, or
proceeding) independently before they sync. "Clients match on PAN" needs a
rule for which id survives, and every device must pick the same one.
Decision: When a natural key (PAN; client + AY; natural_key; reference id;
acknowledgement number; registry code) matches a local row under a different
id, the lexicographically smaller id is canonical everywhere. The local row
and its children are renamed and re-ledgered as local writes; the incoming
row is written under the canonical id.
Rejected: Keeping the local id (devices would disagree); a coordinator
(the relay is zero-knowledge and cannot see PANs).
Reversible: with care — the rule is baked into every device's merge.

## D-018 — A ledger entry that cannot be applied is skipped, not retried
Date: 2026-09-12
Context: A malformed or constraint-violating entry from another device
would otherwise block its whole stream forever.
Decision: `ledger::apply` records the error in its report, advances the
cursor past the entry, and continues. The error is surfaced in the import
summary and, later, the sync state.
Reversible: easily.

## D-019 — Device ids are minted locally and accepted by the relay
Date: 2026-09-12
Context: The ledger keys streams by a device id minted on first open; the
relay needs the same id or every stream would have to be renamed at
enrolment.
Decision: Registration, enrolment and recovery send the device's own id;
the relay checks uniqueness and refuses collisions.
Rejected: Relay-assigned ids with a local rename (a one-time rewrite of
ledger, cursors and entity_versions — fragile for no gain).
Reversible: easily.

## D-020 — Invites carry the firm key; the relay sees only the code
Date: 2026-09-12
Context: The firm key must reach every firm device and never the relay.
Decision: An invite is `firm_id.code.firm_key_hex`, produced on the admin's
device and typed on the new one. The client sends the relay only the code.
The admin is told to treat the invite like a password.
Rejected: A key-exchange protocol over the relay (more machinery than a
CA firm's two to five laptops warrant, and a bigger surface to get wrong).
Reversible: with a protocol change.

## D-021 — "Collector silent" means no report for 26 hours
Date: 2026-09-12
Context: Q17 defaults to a warning after one missed scheduled run; the
default cadence is daily (Q12).
Decision: A constant, `COLLECTOR_SILENT_HOURS = 26`, in `src-tauri/src/sync.rs`.
Reversible: easily.
