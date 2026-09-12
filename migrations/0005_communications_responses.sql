-- 0005 communications (inbound, from the department) and responses
-- (outbound, from the firm). in_reply_to is nullable on purpose: a voluntary
-- submission may exist with no notice behind it.

CREATE TABLE communications (
    id                    TEXT PRIMARY KEY,
    proceeding_id         TEXT NOT NULL REFERENCES proceedings(id),
    communication_type_id TEXT NOT NULL REFERENCES type_registry(id),
    reference_id          TEXT NOT NULL UNIQUE,   -- the portal's "Reference ID" — our natural key
    din                   TEXT,                   -- ITBA document reference
    section_2025          TEXT,
    section_1961          TEXT,
    description           TEXT,
    issued_on             TEXT,
    served_on             TEXT,
    response_due_date     TEXT,
    ao_viewed_on          TEXT,
    status                TEXT NOT NULL DEFAULT 'unknown'
                          CHECK (status IN ('open','adjournment_sought','response_submitted','closed','unknown')),
    direction             TEXT NOT NULL DEFAULT 'inbound' CHECK (direction = 'inbound'),
    verified_flag         INTEGER NOT NULL DEFAULT 0,
    gap_flags             TEXT,
    row_hash              TEXT NOT NULL,
    first_seen_at         TEXT NOT NULL,
    last_seen_at          TEXT NOT NULL,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_communications_proceeding ON communications(proceeding_id);
CREATE INDEX idx_communications_type ON communications(communication_type_id);
CREATE INDEX idx_communications_due ON communications(response_due_date);
CREATE INDEX idx_communications_din ON communications(din);

CREATE TABLE responses (
    id             TEXT PRIMARY KEY,
    proceeding_id  TEXT NOT NULL REFERENCES proceedings(id),
    in_reply_to    TEXT REFERENCES communications(id),
    response_mode  TEXT NOT NULL DEFAULT 'full' CHECK (response_mode IN ('full','partial')),
    filed_on       TEXT,
    filed_by       TEXT,
    remarks        TEXT,
    transaction_id TEXT,
    direction      TEXT NOT NULL DEFAULT 'outbound' CHECK (direction = 'outbound'),
    verified_flag  INTEGER NOT NULL DEFAULT 0,
    gap_flags      TEXT,
    row_hash       TEXT NOT NULL,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_responses_proceeding ON responses(proceeding_id);
CREATE INDEX idx_responses_in_reply_to ON responses(in_reply_to);
