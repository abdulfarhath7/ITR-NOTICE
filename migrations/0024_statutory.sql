-- 0024 Build 5 (docs/19): the public Income Tax Department calendar, firm
-- dates, statutory change events, and the client profile fields the
-- "Applies to us" scope reads. Deadlines and fetches are collector-owned
-- and synced like any table; firm dates are user-authored from any device.

CREATE TABLE statutory_deadlines (
    id            TEXT PRIMARY KEY,           -- sha256(source_date || normalised title)[:16]
    due_on        TEXT NOT NULL,              -- YYYY-MM-DD, the date currently in force
    original_on   TEXT,                       -- YYYY-MM-DD when extended, else NULL
    title         TEXT NOT NULL,              -- portal text, whitespace-normalised, no trailing period
    category      TEXT NOT NULL,              -- docs/19 §2.3
    note          TEXT,                       -- extension / circular text, verbatim
    circular      TEXT,                       -- "15/2025" when parseable, else NULL
    applies       TEXT NOT NULL DEFAULT '[]', -- JSON array of docs/19 §2.4 tags
    source_year   INTEGER NOT NULL,           -- the yfmv the row came from
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    removed_at    TEXT,                       -- set when a row disappears from the source
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_statutory_due ON statutory_deadlines(due_on);
CREATE INDEX idx_statutory_year ON statutory_deadlines(source_year);

CREATE TABLE statutory_fetches (
    id          TEXT PRIMARY KEY,
    source_year INTEGER NOT NULL,
    fetched_at  TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ok','unchanged','failed')),
    page_hash   TEXT,
    rows        INTEGER,
    error       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_statutory_fetches_year ON statutory_fetches(source_year, fetched_at);

CREATE TABLE firm_dates (                     -- user-authored, via the ledger
    id          TEXT PRIMARY KEY,
    due_on      TEXT NOT NULL,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'firm',
    note        TEXT,
    created_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_firm_dates_due ON firm_dates(due_on);

-- docs/19 §3.2, §3.4: what a fetch changed. One immutable row per change,
-- synced, so the Updates screen shows it on every device (Q39).
CREATE TABLE statutory_events (
    id          TEXT PRIMARY KEY,
    deadline_id TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('statutory_added','statutory_extended','statutory_removed','statutory_unparsed')),
    payload     TEXT NOT NULL,                -- JSON {title, from, to, circular, note}
    at          TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_statutory_events_at ON statutory_events(kind, at);

-- docs/19 §2.4: set by a person on the Profile tab, never inferred.
ALTER TABLE clients ADD COLUMN entity_kind  TEXT CHECK (entity_kind IN ('individual','huf','firm','llp','company','trust','other'));
ALTER TABLE clients ADD COLUMN audit_case   INTEGER NOT NULL DEFAULT 0 CHECK (audit_case IN (0, 1));
ALTER TABLE clients ADD COLUMN tp_case      INTEGER NOT NULL DEFAULT 0 CHECK (tp_case IN (0, 1));
ALTER TABLE clients ADD COLUMN tds_deductor INTEGER NOT NULL DEFAULT 0 CHECK (tds_deductor IN (0, 1));
