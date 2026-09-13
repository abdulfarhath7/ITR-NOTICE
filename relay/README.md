# relay/

The zero-knowledge relay (docs/03, docs/04, docs/07). It stores sealed
blobs and routing metadata, arbitrates the collector lease and per-client
session locks, and enforces four invariants server-side: one admin per
firm, sweep publishes only from the lease holder, one lock per client, and
nothing from a removed device.

It holds no firm key and cannot decrypt anything. PANs never reach it:
locks are keyed by an opaque client key the devices derive themselves.

Run:

    uvicorn relay.main:app --host 0.0.0.0 --port 8790

State lives in one SQLite file (`RELAY_DB`, default `relay.db`, Q05). Set
it to a path outside the checkout in production; the default is for a
local run and is git-ignored.

Environment:

| Variable | Default | Purpose |
|---|---|---|
| `RELAY_DB` | `relay.db` | SQLite file |
| `RELAY_MAX_CHANGESET_MB` | `32` | largest changeset accepted (413 above it) |
| `RELAY_MAX_SNAPSHOT_MB` | `512` | largest snapshot accepted |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS` | unset | collector-silent email (Q17); with no host the alert is only logged |
Auth is an Ed25519 signature over `METHOD\nPATH\nTIMESTAMP\nSHA256(BODY)`
in the `X-Device-Id`, `X-Timestamp` and `X-Signature` headers; the firm's
first device self-signs its registration.
