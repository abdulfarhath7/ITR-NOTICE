-- 0012 responses.response_mode may be NULL: the notice card says a response
-- was filed and when, not whether it was full or partial. A guessed mode
-- would be an invented fact. The table is empty at this point (the backfill
-- created no responses), so it is recreated rather than altered.

DROP TABLE responses;
CREATE TABLE responses (
    id             TEXT PRIMARY KEY,
    proceeding_id  TEXT NOT NULL REFERENCES proceedings(id),
    in_reply_to    TEXT REFERENCES communications(id),
    response_mode  TEXT CHECK (response_mode IN ('full','partial')),
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
