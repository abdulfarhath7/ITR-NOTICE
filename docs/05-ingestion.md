# 05 — Ingestion

## The five constraints that shape everything

These are properties of the portal, not design preferences. They were
supplied by the domain team and are assumed true (see `QUESTIONS.md` Q08–Q11).

1. **One live session per taxpayer.** A new login evicts the previous one.
   Parallel fan-out across clients does not merely risk lockouts, it breaks
   itself. Ingestion is a **sequential queue**.
2. **A human clears login.** Password, captcha and often an OTP. The service
   is built around an **attended, resumable run**, not an unattended job.
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
marking the client failed.

**Never retry a bad password.** One failure parks the client for the run. A
second attempt risks locking the taxpayer out of their own account. Surface it
as "credentials need attention", not as an error to retry.

**Document first, row second.** Fetch the PDF, hash it, store it, then write
the index row referencing the hash. A row pointing at a document that was
never stored is worse than no row.

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
