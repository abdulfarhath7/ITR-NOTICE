-- 0014 the change ledger (docs/03-sync-and-ledger.md). Entries are keyed
-- (device_id, seq): one monotonic stream per device, so several devices
-- write without colliding. A device cursor is a map of device_id to the
-- last seq applied. entity_versions records which (updated_at, device_id)
-- currently holds each row so every device resolves a conflict the same
-- way: last write wins on updated_at, device_id as the tiebreaker.

CREATE TABLE ledger (
    device_id   TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    op          TEXT NOT NULL CHECK (op IN ('upsert','delete')),
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    payload     TEXT NOT NULL,                    -- JSON of the full row after the change
    created_at  TEXT NOT NULL,
    PRIMARY KEY (device_id, seq)
);
CREATE INDEX idx_ledger_entity ON ledger(entity_type, entity_id);
CREATE INDEX idx_ledger_created ON ledger(created_at);

CREATE TABLE sync_cursors (
    device_id  TEXT PRIMARY KEY,
    seq        INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE entity_versions (
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    device_id   TEXT NOT NULL,
    PRIMARY KEY (entity_type, entity_id)
);
