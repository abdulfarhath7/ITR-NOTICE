-- 0021 entries received from other devices (Q39). `ledger` holds only this
-- device's own stream; an applied foreign entry is written to its rows but
-- was not kept as an entry, so the Updates screen (docs/16 §4) saw nothing
-- on a device that does not sweep. Local only, never synced: the entries
-- already live on the relay under their own device's stream.

CREATE TABLE ledger_received (
    device_id   TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    op          TEXT NOT NULL CHECK (op IN ('upsert','delete')),
    entity_type TEXT NOT NULL,
    entity_id   TEXT NOT NULL,                    -- the local id after merge
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,                    -- when the origin device wrote it
    source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','sweep')),
    received_at TEXT NOT NULL,
    PRIMARY KEY (device_id, seq)
);
CREATE INDEX idx_ledger_received_entity ON ledger_received(entity_type, entity_id);
CREATE INDEX idx_ledger_received_created ON ledger_received(created_at);
