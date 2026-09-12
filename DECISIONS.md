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
