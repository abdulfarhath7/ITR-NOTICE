# 05 — Ingestion

## The five constraints that shape everything

These are properties of the portal, not design preferences. They were
supplied by the domain team and are assumed true (see `QUESTIONS.md` Q08–Q11).

1. **One live session per taxpayer.** A new login evicts the previous one.
   Parallel fan-out across clients does not merely risk lockouts, it breaks
   itself. Ingestion is a **sequential queue**.
2. **A human may be needed at login.** In practice an OTP is rare or never
   (Q09), so runs are **scheduled and unattended** by default; the
   attended, resumable machinery stays as the fallback: a captcha or OTP
   pauses the run and alerts, it never fails it.
3. **Six panels, not one.** e-Proceedings is served under three views —
   Self, Of Other PAN or TAN, As Authorized Representative — each with a
   "For your action" and a "For your information" tab. A practitioner's book
   sits mostly in the third view. Sweep all six; record zero counts.
4. **Single-page app, unstable markup, no deep links.** Screens are reached
   by menu traversal. Use anchored selectors and a per-field confidence flag.
5. **The list view is a header; the PDF is the record.** Queries raised and
   documents called for sit inside the notice PDF.

## Run lifecycle

```
operator starts run
        │
        ▼
resume from last position (or start fresh)
        │
        ▼
for each client in queue:            ← strictly one at a time
        acquire per-client lock
        open session  ──► human clears captcha / OTP  (queue WAITS)
        for each of the six panels:
              read list rows
              hash each row (din + status + due_date + gap_flags)
              known and unchanged? → increment streak; 10 in a row → stop panel
              new or changed?      → fetch detail, download PDF, hash, store
              record panel result including zero counts
        write ingestion_runs row
        release lock
        │
        ▼
publish changeset
```

## Rules

**Never fail on a human.** When the run needs a captcha or OTP, the job state
becomes `awaiting_operator` and stays there. No timeout, no retry storm, no
marking the client failed. The app raises an OS notification and a sidebar
pill; a scheduled run waits the same way.

**Concurrency is one constant.** `INGESTION_WORKERS` (default 1) is the
only place sequentiality lives (Q08, D-028). Nothing else assumes it.

**Never retry a bad password.** One failure parks the client for the run. A
second attempt risks locking the taxpayer out of their own account. Surface it
as "credentials need attention", not as an error to retry.

**Document first, row second, whenever a document is fetched.** Fetch the
PDF, hash it, store it, then write the index row that references the hash. A
row pointing at a document that was never stored is worse than no row.

Index-only rows are allowed (docs/17 §5, Build 3). A sweep records a header
and leaves its document on the portal. The invariant is now:

- a `documents` row in state `stored` has a `file_hash` and a `storage_path`;
- a row in state `pending` has a `source_url` of the form
  `portal:<parent_type>:<reference>`, or a parent that carries the portal
  reference (a return's or form's acknowledgement number), so an item fetch
  can find it.

**Zero is a finding.** A panel that returns nothing writes an `ingestion_runs`
row with `records_found = 0`. Skipping a panel and recording nothing are
indistinguishable later, and that ambiguity is how misses happen.

**Blank beats guessed.** If the portal does not display a field, write NULL
and add the column name to `gap_flags`. Never infer, never carry forward from
a sibling row, never default to today.

**Confidence flag per field.** If an anchored selector matched loosely or the
value failed its format check, store it and set `verified_flag = 0`. Do not
discard it, and do not present it as confirmed.

## Early-stop delta walk

Rows are newest first. Maintain a streak counter of consecutive rows whose
`row_hash` is already stored and unchanged. At ten, stop that panel and move
on. The hash includes status, so a proceeding moving open → submitted breaks
the streak correctly.

Reset the streak on any change. Never stop on the first match — portals
reorder rows.

## Scopes and the overnight run (Build 3, docs/17)

Three scopes share the queue, the runner and the sidecar:

- **Sweep**, nightly or `Sync now`. New rows issued within `lookback_days`
  (default 30) plus every stored row, index only.
- **Deep fetch**, one client, on request, to a depth: everything, the last N
  AYs, or since a date. Index or download. No early stop.
- **Item fetch**, one proceeding or return, downloads its documents.

A settled item is never touched by a sweep. Only a deep or item fetch reads
it again.

**The probe.** Before walking a login, the runner asks the sidecar to hash
the first two pages of each panel from portal row content only. When every
hash matches the stored one, the job is done with `records_found = 0` and
`notes = 'unchanged'`. A login with open items is never skipped (D-050). A
failed probe or a first sweep is never skipped either.

**The window.** A scheduled run keeps to `run_window_start`–`run_window_end`
(default 01:00–06:00 IST). It checks the clock between clients and between
panels. At the end it saves the cursor and marks the sweep `stopped`, with
`window_closed` in its summary. The next scheduled sweep starts with the
unfinished jobs. A job that runs past `client_timeout_min` (default 3) is
`incomplete` with its cursor saved. Running out of time is never a failure.

**The pipeline.** Order the clients (§2.1 of docs/17, frozen into
`ingestion_jobs.position`). Probe, then sweep. Then drain the deep requests
queued for tonight, and warm the cache when at least 20% of the window is
left. Last comes the summary.

**The tiers.** After its sweep a client moves to `weekly` when it has no open
items, nothing issued in `dormant_after_days` (default 90), and no deep fetch
queued. It moves back to `nightly` on any change. Weekly clients join the run
on `dormant_weekday` only. A pinned client (`cadence_pinned`) stays nightly.

## Parsing discipline

Write parsers from **live DOM and HAR captures**, never from screenshots.
This has already caused one bug in this codebase. Capture `outerHTML` of the
list container and the network responses behind it, commit the fixtures
(scrubbed of PAN and names), and write the parser against those.

## Cadence

Per `QUESTIONS.md` Q12. Defaults: proceedings daily, demands daily, returns
weekly, forms weekly. Not everything needs a nightly sweep, and cadence is
where most of the run window is won back.

## Resumability test

Kill the process mid-run. Restart. It must continue from the next client, not
from the beginning, and must not duplicate any row. This is an acceptance
criterion, not an aspiration.
