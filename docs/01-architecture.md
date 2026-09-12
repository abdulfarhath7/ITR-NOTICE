# 01 — System architecture

## Shape

```
            Income tax e-Filing portal
                       |
                  (read only)
                       v
  +--------------------------------------------+
  |  COLLECTOR DEVICE  (one per firm at a time) |
  |                                             |
  |  scheduler -> job queue -> Playwright       |
  |  sidecar -> parser -> local SQLite          |
  |  a human clears captcha and OTP             |
  +--------------------------------------------+
                       |
                change ledger
                       |
                seal with firm key
                       v
             +--------------------+
             |   RELAY SERVICE    |   stores opaque blobs
             |  (zero-knowledge)  |   cannot decrypt anything
             +--------------------+
                       |
        +--------------+--------------+
        v              v              v
   Laptop A        Laptop B      Partner's PC
   full local      full local    full local
   copy            copy          copy
```

## Principles

**Local-first.** Every device holds the complete database. The app is fully
usable with no network. Sync is a background nicety, never a dependency.

**One writer per stream.** Ledger entries are keyed by originating device, so
several devices can write without colliding. Only the lease holder publishes
whole-book sweeps.

**The relay is dumb and blind.** It routes sealed blobs and arbitrates the
collector lease. It holds no key and can decrypt nothing.

**The document is the record.** The scraped row is an index. The PDF is the
truth. Fetch and hash the document before writing the row that points at it.

**Source-independent identity.** A work item is identified by its DIN or
reference number plus a content hash — never by which engine fetched it. A
client migrating from scraper to the ERI API must produce zero duplicates.

## Processes

| Process | Language | Responsibility |
|---|---|---|
| Desktop shell | Rust (Tauri 2) | Windowing, keychain, SQLite/SQLCipher, sync client, lease renewal |
| Frontend | React + TypeScript + Vite | All UI |
| Ingestion sidecar | Python + Playwright | Portal session, DOM extraction, PDF download |
| Relay | Python + FastAPI | Firm registry, device enrolment, blob store, lease |

The sidecar is spawned by the Rust core and communicates over line-delimited
JSON on stdio. It never touches the database directly — it emits parsed
records and the Rust core persists them.

## Why the sidecar does not write to the database

Two reasons. Every write must append a ledger entry in the same transaction,
and that logic lives in one place. And the sidecar is the component most
likely to crash mid-run; it must not be able to leave a half-written row.

## Failure behaviour

| Failure | Behaviour |
|---|---|
| Sidecar crashes | Job returns to queue with attempt+1; run resumes at next client |
| Network drops mid-publish | Changeset stays local; publish retries on next sync |
| Relay unreachable | App works normally; sync shows "cannot reach relay" |
| Collector machine dies | Lease expires; admin nominates another device |
| Portal session evicted | Current client is marked incomplete, not failed; retried next run |
| Wrong password | Client parked immediately. Never retried in the same run. |

That last row matters: repeated wrong-password attempts lock a taxpayer out
of their own account.
