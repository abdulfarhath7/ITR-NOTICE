-- 0006 adjournment_requests: the portal treats an adjournment as its own
-- action, so it is its own object.

CREATE TABLE adjournment_requests (
    id            TEXT PRIMARY KEY,
    proceeding_id TEXT NOT NULL REFERENCES proceedings(id),
    sought_date   TEXT,
    reason        TEXT,
    outcome       TEXT,                           -- granted, refused, pending, NULL = not stated
    filed_on      TEXT,
    verified_flag INTEGER NOT NULL DEFAULT 0,
    gap_flags     TEXT,
    row_hash      TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_adjournment_requests_proceeding ON adjournment_requests(proceeding_id);
