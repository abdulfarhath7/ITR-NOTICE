"""The relay's own SQLite. Blobs are opaque; everything else is routing."""
import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

DB_PATH = os.environ.get("RELAY_DB", "relay.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS firms (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    admin_device_id    TEXT,
    recovery_code_hash TEXT NOT NULL,
    created_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    firm_id     TEXT NOT NULL REFERENCES firms(id),
    name        TEXT NOT NULL,
    public_key  TEXT NOT NULL,              -- base64 Ed25519
    permission  TEXT NOT NULL CHECK (permission IN ('admin','member')),
    role        TEXT NOT NULL CHECK (role IN ('collector','normal')),
    ram_mb      INTEGER,
    email       TEXT,                       -- for collector-silent alerts (Q17); a staff address
    enrolled_at TEXT NOT NULL,
    last_seen   TEXT,
    removed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_firm ON devices(firm_id);
CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    firm_id    TEXT NOT NULL REFERENCES firms(id),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_by    TEXT,
    used_at    TEXT
);
CREATE TABLE IF NOT EXISTS changesets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id    TEXT NOT NULL REFERENCES firms(id),
    device_id  TEXT NOT NULL,
    seq_from   INTEGER NOT NULL,
    seq_to     INTEGER NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('user','sweep')),
    blob       BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changesets_firm_device ON changesets(firm_id, device_id, seq_to);
CREATE TABLE IF NOT EXISTS snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id    TEXT NOT NULL REFERENCES firms(id),
    device_id  TEXT NOT NULL,
    cursor     TEXT NOT NULL,               -- JSON cursor map (routing metadata)
    blob       BLOB NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leases (
    firm_id    TEXT PRIMARY KEY REFERENCES firms(id),
    device_id  TEXT NOT NULL,
    nominee_id TEXT,                        -- the admin's current nomination
    issued_at  TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nominations (
    firm_id    TEXT PRIMARY KEY REFERENCES firms(id),
    device_id  TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS locks (
    firm_id    TEXT NOT NULL,
    client_key TEXT NOT NULL,               -- opaque; derived by devices, never a PAN
    device_id  TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    PRIMARY KEY (firm_id, client_key)
);
CREATE TABLE IF NOT EXISTS refresh_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id    TEXT NOT NULL,
    client_key TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    taken_at   TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
    firm_id       TEXT PRIMARY KEY,
    silent_since  TEXT,
    last_email_at TEXT
);
CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id    TEXT NOT NULL,
    device_id  TEXT,
    action     TEXT NOT NULL,
    detail     TEXT,
    created_at TEXT NOT NULL
);
"""


def init(path: str | None = None) -> None:
    with connect(path) as con:
        con.executescript(SCHEMA)
        # column added after the first schema; existing files get it here
        have = {r["name"] for r in con.execute("PRAGMA table_info(devices)")}
        if "email" not in have:
            con.execute("ALTER TABLE devices ADD COLUMN email TEXT")


@contextmanager
def connect(path: str | None = None) -> Iterator[sqlite3.Connection]:
    con = sqlite3.connect(path or DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()
