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

State lives in one SQLite file (`RELAY_DB`, default `relay.db`, Q05).
Auth is an Ed25519 signature over `METHOD\nPATH\nTIMESTAMP\nSHA256(BODY)`
in the `X-Device-Id`, `X-Timestamp` and `X-Signature` headers; the firm's
first device self-signs its registration.
