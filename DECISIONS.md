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

## D-022 — The proceedings sheet is one row per proceeding
Date: 2026-09-12
Context: docs/11's 17 columns mix proceeding-level fields (type, name,
created mode) with communication-level ones (DIN, issued on) and
response-level ones (submitted on).
Decision: One row per proceeding. DIN and Issued On come from the
proceeding when it carries them, else from its earliest communication;
Response Submitted On is the latest filed response. A firm that wants a
row per notice gets it from the Attention view's own export scope.
Rejected: A row per communication (would repeat the proceeding columns and
break the "S.No per matter" the firm's tracker uses).
Reversible: easily.

## D-023 — "Unverified fields" counts gap-flagged fields
Date: 2026-09-12
Context: The header block's third line needs a number.
Decision: The sum of `gap_flags` entries across exported rows — the fields
that export as blank because the portal did not state them.
Reversible: easily.

## D-024 — The first-run wizard gates on a local flag, not on the relay
Date: 2026-09-12
Context: The app must be fully usable without a relay (docs/01
"local-first"), so "set up sync" cannot be mandatory.
Decision: The wizard shows until `local_kv.setup_done` is set, which
"Go to Clients" and "Skip for now" both set. Firm, collector and clients
are each optional steps that can be done later from their screens.
Reversible: easily.

## D-025 — Settings shows "Workers: 1" as a fact, not a control
Date: 2026-09-12
Context: TASKS 10.3 lists a worker count; D-002 makes ingestion strictly
sequential because the portal allows one session per taxpayer (Q08).
Decision: The setting is displayed with the reason and cannot be changed.
If Q08 is answered "false", this becomes a control and the runner gains a
pool.
Reversible: easily.

## D-026 — Litigation Command Center everywhere; identifier `in.lcc.app`
Date: 2026-09-12
Context: Q21 answered: the product is Litigation Command Center ("Center"),
and `in.llc.app` was a typo for the LCC acronym. Supersedes D-012.
Decision: Display name, window title, export header, installer name and
the bundle extension (`.lcc`) all say LCC. The bundle identifier and the
keychain service become `in.lcc.app`; the first run of the new build moves
an archive found under the old folder and copies keychain entries forward
from the old service name, so no installed archive is orphaned. Crate and
npm package names stay `llc` (invisible to users; not worth a rename).
Reversible: the identifier deliberately not, after the first installer.

## D-027 — Unattended by schedule, attended as the fallback (supersedes D-002)
Date: 2026-09-12
Context: Q09 answered: OTP is rare or never in practice. D-002 built the
whole run around a human at the machine.
Decision: A scheduler (`ingest/scheduler.rs`, Settings → Unattended sweep)
starts a sweep at a configured IST time on configured days, once per day,
on the collector only when a relay is configured. The run is the same
attended runner: a captcha or OTP pauses the job (`awaiting_operator`)
and the app alerts with an OS notification and a sidebar pill; nothing
times out or fails for want of a person. Sequential ingestion stands
until Q08 is tested (D-028).
Rejected: A separate unattended code path (two runners to keep honest).
Reversible: easily.

## D-028 — Concurrency is one constant, default 1
Date: 2026-09-12
Context: Q08 is untested; the answer asked that raising concurrency not
need a rewrite.
Decision: `INGESTION_WORKERS` in `ingest/runner.rs`. The run is a pool of
that many workers claiming jobs atomically; each job owns its sidecar and
browser. The two live tests that would justify raising it are in NOTES.md.
Reversible: easily — that is the point.

## D-029 — A manual due date may override the portal's; both are shown
Date: 2026-09-12
Context: Q14 answered "allow override, show both". Supersedes the
fill-a-blank-only rule.
Decision: `manual_due_date` drives the Attention ranking, the overdue
calculation and every due cell; the portal's `due_date` is shown beside it,
labelled, and exported in its own column. A promoted suggestion writes
`manual_due_date`, never `due_date`. The portal's field is never
overwritten.
Reversible: easily.

## D-030 — The proceeding card's stepper date is not read
Date: 2026-09-12
Context: Q22 answered "ignore that date".
Decision: The parser keeps the stepper's status word and drops its date;
`initiated_on` and `closure_date` stay nullable and unpopulated by the
portal engine. The export's Issued On comes from the earliest
communication; with none it is blank and gap-flagged.
Reversible: easily.

## D-031 — Remote wipe is best-effort and says so
Date: 2026-09-12
Context: Q16 answered "wipe the local copy as well as revoking access".
Decision: A removed device, on its next relay contact (every sync and a
ten-minute tick), pushes its pending user entries (the relay accepts a
removed device's final push and nothing else), then deletes the archive,
viewer scratch, settings and every keychain entry, writes `removed.flag`,
and shows a plain removed screen on every launch. The admin dialog states
that this happens only if the device comes online and the app is opened.
Rejected: Promising a wipe (a disk image is unreachable); refusing the
final push (would lose the firm's own edits made on that device).
Reversible: easily.

## D-032 — Collector-silent alerts: banner everywhere plus one email a day
Date: 2026-09-12
Context: Q17 answered "banner AND email to everyone after one missed
scheduled run", debounced.
Decision: The banner is client-side, already. The relay runs an hourly
pass: when the collector has not reported for 26 hours it emails every
device address of the firm, at most once per 24 hours while silent, and
once more when the collector returns (`relay/alerts.py`, pure decision
function with tests). Addresses are optional, entered at enrolment or on
Devices, and live on the relay (docs/07).
Reversible: easily.

## D-033 — Settings is one section per concern, built from one row vocabulary
Date: 2026-09-13
Context: The settings screen had grown into a grid of unrelated cards, and
new settings (alert email, this-device facts) were landing on whichever
screen was nearest.
Decision: `src/screens/settings/` holds one file per section (General,
Sweeps, Drafting, Notifications, Data, Firm and sync, About) listed down
the left, each built from `Section`/`Row`/`Segmented` in `ui.tsx`, with a
save bar that appears only while something changed. The route carries the
section (`#/settings/<section>`). The alert email and this-device facts
moved here from Devices; Devices keeps the roster and the two sync facts.
Rejected: Tabs across the top (does not scale past five); one long page
(no way to link to a setting).
Reversible: easily.

## D-034 — The query layer caches, de-duplicates and revalidates
Date: 2026-09-13
Context: Every mounted `useQuery` fetched on its own, so the shell's
attention badge and the Attention screen each pulled every work item, and
every screen revisit painted "Loading".
Decision: `src/lib/query.ts` keeps an immutable snapshot per key, shares
one in-flight call between subscribers, serves the cached value while a
refetch runs, and drops entries nobody watches after five minutes.
`invalidate(prefix)` marks mounted entries stale and forgets the rest.
Work-item keys are normalised so `{}` and `{client_ids: null}` are one key.
Rejected: A third-party query library — the surface needed is four
functions and no dependency.
Reversible: easily.

## D-035 — The dead-code lint is on; contract members are allowed by name
Date: 2026-09-13
Context: `#![allow(dead_code)]` had been left on crate-wide since Phase 1
with a note to lift it after Phase 7. Nineteen unused items had collected
behind it, including the legacy notice commands.
Decision: The allow is gone; unused items are deleted. Only the two
`NoticeSource` members the docs/06 contract reserves for ERI
(`fetch_item`, `health`, and `SourceHealth`) carry a narrow allow with the
reason beside them, and `ledger::tail` is `#[cfg(test)]` for the docs/12
snapshot test.
Reversible: easily.

## D-036 — The relay caps blob sizes and never blocks its event loop
Date: 2026-09-13
Context: A changeset or snapshot of any size was accepted, and a wrong
recovery code slept the whole server for a second.
Decision: 413 above `RELAY_MAX_CHANGESET_MB` (32) and
`RELAY_MAX_SNAPSHOT_MB` (512); the wrong-code delay is an `asyncio.sleep`
outside the database connection; the hourly alert pass with its blocking
SMTP runs on a worker thread.
Reversible: easily.

## D-037 — The proceeding thread is a two-lane flow
Date: 2026-09-23
Context: The thread was a flat stack of cards; nobody could see at a glance
what was answered, open, overdue or adjourned.
Decision: `src/ui/thread-flow.tsx` draws department notices on the left,
firm responses and adjournments on the right, one spine between, per
`docs/thread-flow-context.md`. Pairing is pure, in
`src/lib/thread-pairing.ts`, with vitest cases. The Draft button moved from
the notice card into the empty response slot. Defaults filed as Q25–Q29.
Reversible: easily; the old `Thread` is in git history.

## D-038 — `work_item_meta` keys on `module:item_id`
Date: 2026-09-24
Context: docs/16 §2.2 gives the table a composite primary key; every
synced table's write and ledger path (`rows::write_value`, merge,
snapshots) keys on an `id` column.
Decision: the table keeps `module` and `item_id` (unique together) and
adds `id = 'module:item_id'`, which is also the ledger entity id the spec
asks for. Two devices writing the same item's meta name the same row, so
last-write-wins settles it with no natural-key rule.
Reversible: yes, with a migration.

## D-039 — New nullable columns on synced rows are skipped when unset
Date: 2026-09-24
Context: `drafts.reviewed_at` (0018) is newer than the legacy backfill
(0009), which writes drafts through the same struct; serialising the new
field would make 0009 fail on an old archive.
Decision: `Draft.reviewed_at` is `skip_serializing_if = "Option::is_none"`.
Clearing it (regenerate, un-review) writes an explicit JSON null through
`drafts::save_unreviewed`, so the clear still reaches other devices.
Reversible: easily.

## D-040 — Text size scales through `rem`, not CSS zoom
Date: 2026-09-24
Context: docs/16 §3 sets the root font size from `ui_scale`.
Decision: every text size, line height, control and row height, padding,
margin and gap in `tokens.css` and `base.css` is in `rem` (16px base);
borders, radii, shadows, the switch's geometry and the thread-flow
drawing (positions computed in JS) stay in `px`. The value is cached in
`localStorage` (`lcc.ui_scale`) so boot applies it before first paint; the
source of truth is `settings.json`.
Reversible: easily.

## D-041 — The sync line's window is the sweep holding the newest run
Date: 2026-09-24
Context: docs/16 §1.1 counts clients and failures "in that run window";
runs are per client and panel, each with its own `run_at`.
Decision: the window runs from the start of the newest sweep that began
at or before the newest run, to that run. A run with no sweep row is its
own window.
Reversible: easily (`repo/runs.rs::sync_line`).

## D-042 — Updates diff each entity once, against its state before `since`
Date: 2026-09-24
Context: docs/16 §4.2 compares an entry with "the previous entry for the
same entity"; an item written twice in one sweep would appear twice.
Decision: per entity, the newest upsert after `since` is compared with the
newest at or before `since`. `since` is the previous completed sweep's
end. Only this device's ledger stream is read (Q39).
Reversible: easily.

## D-043 — Draft and ✦ Date from a list act on the newest open notice
Date: 2026-09-24
Context: Attention rows are proceedings; the detail screen's Draft and
✦ Date act on one communication.
Decision: from a list row they act on the proceeding's newest open inbound
communication. ✦ Date is enabled only when the item has no effective due
date, as the flow exists to find a missing one.
Reversible: easily.

## D-044 — A client's Sync switch leaves Sync now working
Date: 2026-09-24
Context: docs/16 §7 adds a per-client sync enable.
Decision: `sync_enabled = 0` removes the client from whole-book and module
sweeps (and so the scheduler); a client-scoped run started by a person
still runs, since that is an explicit request.
Reversible: easily (`queue::create_sweep`).

## D-045 — Build 2 extensions keep existing work in place
Date: 2026-09-24
Context: several Build 2 tasks describe replacing something already built:
the two-lane thread flow (19.1), the client edit dialog (20.4), the
rank-count row (15.2).
Decision: the thread flow stays (Q40); Edit opens the existing client form
dialog rather than a new in-place form; the rank row is removed from the
UI only, and the ranks still order the list and label its group headers.
Reversible: yes.

## D-046 — Export widths are computed, capped at 60, and Owner/Note trail
Date: 2026-09-24
Context: docs/16 §8.
Decision: `autofit` is replaced by widths from the longest cell per column
(header included) capped at 60 characters. Owner and Note are columns 17
and 18 of the Proceedings sheet; the 16 are untouched (Q01). A fourth
provenance line names the active filters; it uses row 4, which was blank,
so the column headers stay on row 5.
Reversible: easily.

## D-047 — Search is neither persisted nor a chip
Date: 2026-09-24
Context: docs/16 §1.3 forbids persisting search text; §1.4 lists the chip
kinds without search.
Decision: search lives in component state, is cleared by Clear all and by
Escape, and is written into an export's filter line when active.
Reversible: easily.

## D-048 — Calendar tones apply to the Due view only
Date: 2026-09-24
Context: docs/16 §5 tones a day danger when it is past and holds open
items. In the Issued view every counted day is in the past.
Decision: the Issued view shows neutral pills.
Reversible: easily.

## D-049 — Received ledger entries are kept locally for Updates (Q39)
Date: 2026-09-24
Context: Q39 answered B: Updates must work on devices that do not sweep.
Decision: migration 0021 `ledger_received` (local, not synced) records each
applied foreign entry in the apply transaction. A non-sweeping device
infers sweeps from received sweep-source entries separated by more than
30 minutes. Failed runs are still local to the collector.
Reversible: yes; the table can be dropped with no effect on sync.

## D-050 — The probe skips only logins with no open items (Q47)
Date: 2026-09-25
Context: docs/17 §2.2 hashes each listed row's `din + status + due_date + gap_flags`. An e-Proceedings listing card shows no DIN, due date or reply state. Those live one level down, on the notice cards. A hash built from listing cards alone would miss a changed due date on an open notice.
Decision: the sidecar hashes the listing cards' parsed fields. It hashes only portal content, never anything the tool computes. The runner probes a login, and may skip it, only when that login has no open proceedings. A login with open items is always walked in full. The early-stop streak keeps that walk short.
Reversible: yes. One condition in `Runner::probe`.

## D-051 — Out-of-window rows do not feed the streak on "For your action" panels
Date: 2026-09-25
Context: §2.3 skips new rows older than `lookback_days` and keeps the ten-row early stop. Newest-first listings would stop quickly on old rows. That could cut off a stored open item listed after them.
Decision: on `:information` panels and module lists, an out-of-window row counts toward the streak. On `:action` panels it does not, so every open item there is re-read each night.
Reversible: easily.

## D-052 — The run window binds scheduled runs only
Date: 2026-09-25
Context: §2.7 sets a 01:00–06:00 window. A person pressing `Sweep all now` at 11:00 is outside it.
Decision: `SweepScope.scheduled` marks scheduler-started sweeps. Only those stop at `run_window_end`, drain `tonight` deep requests and warm the cache. Manual runs have no window. The per-client timeout applies to every sweep-kind run.
Reversible: easily.

## D-053 — A changed row never demotes a stored document
Date: 2026-09-25
Context: §2.3 says a changed row marks its documents `pending`. A due date moved by an adjournment does not change the notice PDF already stored.
Decision: `Index` records the header. It creates a `pending` document only where none is `stored`.
Reversible: yes.

## D-054 — "History fetched" is the client's own ledger entry
Date: 2026-09-25
Context: §2.4 asks for a `history_fetched` ledger entry. Ledger entries are table upserts, and another device rejects an unknown entity type on apply.
Decision: finishing a deep fetch writes `history_depth`, `history_fetched_at` and `history_note` to the client, so the client row carries it. Updates classifies a clients entry whose `history_fetched_at` moved as `history_fetched`. The item count is read at display time.
Reversible: yes.

## D-055 — "Last N assessment years" counts back from the current filing year
Date: 2026-09-25
Context: §2.4 depth `years` means "the latest N AYs". The portal lists AYs only as rows appear.
Decision: the latest AY is the one filed in the current financial year (FY 2026-27 files AY 2026-27). A row is inside when its AY start year is at least latest − N + 1. A blank AY is inside (blank beats guessed).
Reversible: easily. `decide::latest_ay_start`.

## D-056 — `Run now` while a run holds the session queues right after it
Date: 2026-09-25
Context: §2.4 says the UI reports "a sweep is running, queued for after it".
Decision: the request keeps `mode = 'now'` and stays `queued`. Every run drains queued `now` requests when its own jobs end, whether scheduled or manual. Item fetches asked for while busy are queued the same way (`item_fetch_queue` in local_kv).
Reversible: yes.

## D-057 — Carried-over jobs move into the next scheduled sweep
Date: 2026-09-25
Context: §2.7: a run that stopped on the window boundary resumes next night at the same position, then re-orders.
Decision: the next scheduled sweep puts the previous window-closed sweep's unfinished jobs first, with their cursors. The rest follows in the fresh §2.1 order. The old jobs are marked `cancelled` with the note "carried to the next run", so no job is carried twice.
Reversible: yes.

## D-058 — The Sync screen keeps the Build 1 sweep options, collapsed
Date: 2026-09-25
Context: docs/17 §6.1 replaces the Ingestion layout. The old screen had the module picker, "Sweep what is due" and a one-client start.
Decision: those options sit in a collapsed "More sweep options" section. The old Jobs table is gone; the queue table replaces it. The old per-panel run history is a collapsed "Panel history" section with a Scope column.
Reversible: easily.

## D-059 — The "Last night" card is "Last run" outside the night
Date: 2026-09-25
Context: docs/17 §2.8 titles the Updates card "Last night".
Decision: the card is titled "Last night" when the sweep started between 18:00 and 09:00 IST and finished within 20 hours. Otherwise it is "Last run". Parked, deep fetched and warm cached counts appear only when not zero.
Reversible: easily.

## D-060 — Deleting a client is a hard, synced delete
Date: 2026-09-25
Context: the user asked for a delete option on clients. Nothing deleted clients before.
Decision:
- Every row under the client is removed children first, each through `rows::delete_with`: documents, drafts, owner/note meta, responses, adjournments, notices, payments, demand replies, demands, returns (newest revision first), forms, proceedings, years, then the client.
- Each removal is a ledger delete, so other devices remove the same rows when they sync.
- Local rows: the run audit keeps its rows with the client id cleared; deep requests go; probe hashes go unless the login is shared. Blobs no document references are dropped.
- The keychain entry goes unless another client uses the same login.
- Refused while a run is in flight. The dialog asks for the client's name.
Reversible: no. The dialog says so and suggests exporting first.

## D-061 — Viewed by AO and Limitation follow a registry flag, not section strings (Q50)
Date: 2026-09-25
Context: docs/18 §3.2 makes both fields assessment-only. The registry had no such flag.
Decision: migration 0023 adds `type_registry.is_assessment` and seeds it for scrutiny, faceless, reassessment, best judgement and penalty. The read models expose `is_assessment`; every cell, chip, tile and export column reads the flag. Changing which rows count is the one UPDATE in the migration.
Reversible: yes, by data.

## D-062 — Event kinds are rows of `proceeding_events` (Q60)
Date: 2026-09-25
Context: docs/18 §3.4 wants `ao_viewed` and `limitation_changed` ledger entries. Ledger entries are table upserts and `apply` refuses unknown entity types.
Decision: a synced, immutable `proceeding_events` table (kind, JSON payload, at). Intake writes `ao_viewed` on the null → date flip of an existing communication and stamps `ao_viewed_first_seen_at` once; `set_limitation_date` writes `limitation_changed` with its source. Updates classifies the first sighting of each row. Merge matches on (proceeding, kind, at).
Reversible: yes.

## D-063 — Notice-type colours map to the four semantic tones
Date: 2026-09-25
Context: docs/18 §3.5 names purple, red, amber and grey pills; docs/10 allows danger, warning, success and one accent.
Decision: purple → accent, red → danger, amber → warning, grey → the default pill. The map in `src/lib/notice-type.ts` carries the tone per row.
Reversible: easily.

## D-064 — "No" for Viewed by AO only once a reply is on record
Date: 2026-09-25
Context: docs/18 §3.3 shows `Yes · date` or `No`. A notice with no reply cannot have been viewed by the AO yet; `No` there would read as a delay on the department's side.
Decision: `—` until the latest notice has a reply, then `No` or `Yes · date`. The same rule feeds the export cell (blank / No / Yes).
Reversible: easily; one branch in `ui/ao-cells.tsx` and the export cell.

## D-065 — The Sweep screen keeps the Build 3 queue under the two Build 4 cards
Date: 2026-09-25
Context: docs/18 §7 draws a Nightly sweep card and a Deep fetch card; docs/17 §6.1 drew the run card and the frozen-order queue. Both are specified; §7 says rework, not replace.
Decision: the run card stays on top, the two cards sit under it, then the live session and the queue. The old "More sweep options" section stays collapsed. Nav label is Sweep.
Reversible: easily.

## D-066 — The deep-fetch estimate reads the listing probe's row counts
Date: 2026-09-25
Context: docs/18 §7 wants `AY <first> → <last> · ~n items · ~m min` "from the listing probe", else `Estimate after probe`. The probe stores a hash and a row count per panel (docs/17 §2.2), not AYs.
Decision: `deep_probe_info` returns the AYs the client already holds, the sum of the probe's row counts (None until a probe has run), and docs/17 §2.9's seconds. The line reads `Estimate after probe` until `probe_rows` exists.
Reversible: easily.
