# 12 — Testing

The user tests manually. Do not build a broad automated suite. Write tests
only where a bug would be silent, expensive, or hard to spot by hand.

## Required tests

### Date handling
- `DD/MM/YYYY` parsing with a day above 12, to catch MM/DD inversion.
- Day arithmetic across the IST boundary after 17:30 UTC.
- Every branch of the due-date render table in `09-ui-spec.md`, including NULL.
- A closed item with a past due date never renders as overdue.

### Ledger and sync
- Apply the same changeset twice — no duplicate rows, no changed state.
- Interrupt an apply halfway and resume — final state matches an uninterrupted
  apply.
- Two devices write to the same row; both converge on the same winner.
- New device from snapshot plus tail matches a device that replayed everything.

### Ingestion
- Kill mid-run and resume: continues at the next client, no duplicates.
- Early-stop streak: ten known rows stops the panel; a changed row resets it.
- A zero-result panel writes an `ingestion_runs` row.
- A gap-flagged field is stored NULL and never filled.

### Source independence
- The same work item ingested via `PortalSource` and then `EriSource` produces
  one row, not two.

### Security
- No test fixture, log line or error message contains a PAN, a phone number or
  a password.
- The pre-commit secret hook rejects a staged file containing a fake PAN.

## Fixtures

Parser fixtures are captured `outerHTML` and HAR responses from the live
portal, scrubbed of PAN, names, phone numbers and addresses. Commit the
scrubbed versions. **Never write a parser from a screenshot** — this has
already caused a bug in this codebase.

## Manual smoke checklist

Put this in `docs/SMOKE.md` and keep it current. After any significant change:

1. App starts, database opens.
2. Add a client from a GSTIN; PAN derives correctly.
3. Start a run; the operator challenge appears and the queue waits.
4. A notice appears with its PDF; View and Save both work.
5. A closed notice shows View and Save but no Draft.
6. Export to Excel; the 17 columns are in the right order.
7. Sync on a second device; the behind-count drops to zero.
8. Change the collector; the lease moves.
