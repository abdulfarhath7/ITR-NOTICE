# 15 — Known bugs carried forward

Both are Phase 2. Both share one root cause.

## The root cause

Status is being handled as a boolean. It is a small state machine. The first
bug came from treating "submitted" as "open"; the fix over-corrected and now
treats everything not-open as having no actions at all. Fix the model, not the
symptoms — see the state machine and action matrix in `02-data-model.md`.

## Bug 1 — Negative due dates

**Symptom.** The UI shows values like `-3 days`.

**Two possible causes. Diagnose before fixing.**

*A: the stored date is wrong.* The portal supplies `DD/MM/YYYY`. If anything
parses it as `MM/DD/YYYY`, `03/09/2026` becomes 9 March and lands in the past.
Test with a day-of-month above 12: if `25/09` fails and `03/09` passes, this is
your bug. Fix the parser and re-ingest affected rows.

*B: the stored date is right, the render is raw.* A `due_date − today` integer
is being printed directly. Fix the renderer per the table in `09-ui-spec.md`.

Both may be present. Check both.

**Also fix while here:**
- Store dates as date-only, not timestamps.
- Compute day differences in Asia/Kolkata. Computing in UTC gives an
  off-by-one every evening after 17:30.
- Status wins over date: a closed item never renders as overdue.
- NULL renders as `Not stated`, never as blank or an epoch date.

**Acceptance.** No code path can emit a raw negative day count. Grep for the
subtraction and confirm every call site goes through the formatter.

## Bug 2 — Closed notices have no Save or View button

**Symptom.** Proceedings that are closed or submitted show no actions at all.

**Why it is wrong.** A disposed proceeding is still a record the firm needs to
open — during an audit it is the first thing anyone looks for. Withholding
Draft is correct. Withholding View and Save is not.

**Fix.** Implement the action matrix from `02-data-model.md` in exactly one
place, and have every list row and detail view read from it. Do not scatter
status checks through components.

**Acceptance.** A closed proceeding shows View and Save and no Draft. A
submitted proceeding does the same. An open proceeding shows all three.

## While you are in there

Two smaller things reported alongside:

- Closed items should not appear in the Attention list, but must still appear
  in search, in client detail, and in every export.
- The count badge on Attention must match the number of rows the list actually
  shows. Check the query and the badge use the same predicate.
