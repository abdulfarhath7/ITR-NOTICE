-- 0002 clients and year_contexts: the top of the work-item spine
-- (docs/02-data-model.md). Assessment year moves off proceedings and onto
-- year_contexts.
--
-- The four pre-build tables are renamed legacy_* first so the spec's table
-- names are free. They are read by the app until task 1.9 and dropped by a
-- later migration once the backfill (task 1.8) has reconciled.

ALTER TABLE proceedings RENAME TO legacy_proceedings;
ALTER TABLE notices     RENAME TO legacy_notices;
ALTER TABLE drafts      RENAME TO legacy_drafts;
ALTER TABLE runs        RENAME TO legacy_runs;

-- Local, never synced: device identity, cursors, settings that belong to
-- this installation only.
CREATE TABLE local_kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE clients (
    id               TEXT PRIMARY KEY,
    client_code      TEXT UNIQUE,                 -- the firm's own reference (Q02)
    name             TEXT NOT NULL,
    pan              TEXT NOT NULL UNIQUE,        -- uppercase, 10 chars
    gstin            TEXT,
    entity_type      TEXT NOT NULL DEFAULT 'other'
                     CHECK (entity_type IN ('individual','company','firm','huf','trust','aop','other')),
    client_group     TEXT,
    phone_cc         TEXT NOT NULL DEFAULT '+91',
    phone            TEXT,
    email            TEXT,
    portal_login_ref TEXT,                        -- NULL = own credentials
    source           TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal','eri')),
    client_file_no   TEXT,
    tags             TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_clients_name ON clients(name);
CREATE INDEX idx_clients_client_group ON clients(client_group);

-- assessment_year NULL is the one "year not stated" context a client may
-- have: the portal issues letters (Issue Letter, Recovery Process) that carry
-- no AY, and inventing one is forbidden (D-007).
CREATE TABLE year_contexts (
    id              TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL REFERENCES clients(id),
    assessment_year TEXT,                         -- '2024-25'
    financial_year  TEXT,                         -- '2023-24'
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (client_id, assessment_year)
);
CREATE INDEX idx_year_contexts_client ON year_contexts(client_id);
CREATE UNIQUE INDEX idx_year_contexts_unstated
    ON year_contexts(client_id) WHERE assessment_year IS NULL;
