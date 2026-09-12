# 03 — Change ledger and sync

The mental model is Git. Commits are ledger entries, `origin` is the relay,
`git pull` is the Sync button, "3 commits behind" is the cursor difference.

One difference from Git: a new device must not replay the whole history from
entry one. It starts from a compacted snapshot and replays only the tail.

## ledger

| column | type | notes |
|---|---|---|
| device_id | TEXT | who wrote it |
| seq | INTEGER | monotonic **per device**, starts at 1 |
| op | TEXT | `upsert` or `delete` |
| entity_type | TEXT | table name |
| entity_id | TEXT | |
| payload | TEXT | JSON of the full row after the change |
| created_at | TEXT | |

Primary key `(device_id, seq)`.

**Every write to a synced table appends a ledger entry in the same
transaction.** No exceptions, no batch jobs that skip it. If a write path
cannot append, that write path is wrong.

Synced tables: clients, year_contexts, proceedings, communications,
responses, adjournment_requests, demands, demand_responses, payments,
returns, filed_forms, documents (metadata only), type_registry, drafts.

Not synced: job queue, sidecar scratch, UI state, keychain references.

## Cursors

A device cursor is a map, not a number:

```json
{ "dev_collector_01": 41880, "dev_laptop_a": 19, "dev_laptop_b": 7 }
```

Sync asks the relay: *give me everything after these positions.* The same
request serves a brand-new device (empty map) and a device that is one entry
behind. **There is no separate full-export feature.** If you find yourself
writing one, you have misread this document.

## Apply rules

- **Idempotent.** Applying the same entry twice must be a no-op.
- **Order-safe within a stream.** Entries from one device apply in `seq`
  order. Entries from different devices may interleave freely.
- **Resumable.** Applying a 5,000-entry changeset may be interrupted; on
  restart it continues, it does not restart.
- **Conflict rule.** Last write wins per row, compared on `updated_at`, with
  `device_id` as a tiebreaker so every device resolves identically.
- **Documents dedupe by `file_hash`.** Never re-download a document whose
  hash is already stored.

## Snapshots

Built by the collector. Cadence per `QUESTIONS.md` Q07.

A snapshot is the compacted current state of all synced tables plus the
cursor map at which it was taken. A new device downloads the latest snapshot,
sets its cursor from the snapshot, and replays only entries after it.

Without this, onboarding a laptop gets slower every month forever.

## Transports

Two, same payload format, chosen by availability:

1. **Relay** (default). Collector publishes sealed changesets; devices poll.
2. **File bundle** (fallback). A `.draftax` file moved by email or USB.

### `.draftax` bundle layout

```
manifest.json        schema version, firm id, created_at, cursor map, counts
snapshot.sqlite      compacted state (optional if the tail is small)
ledger.jsonl         entries after the snapshot cursor
documents/<hash>     content-addressed blobs
signature            detached signature over the manifest
```

Whole file encrypted with AES-256-GCM under a key derived from a passphrase
via Argon2id. Credentials are excluded by default; including them requires a
second explicit confirmation.

Import is a **merge, never an overwrite**. Clients match on PAN. Nothing is
deleted because it is absent from the bundle.

## What "behind" means in the UI

Show two independent facts, never collapsed into one:

1. How many entries this device has not applied, broken down by origin device.
2. When the collector last reported.

"You are up to date" while the collector has been dead for four days is the
most dangerous message this app can display. See `09-ui-spec.md`.
