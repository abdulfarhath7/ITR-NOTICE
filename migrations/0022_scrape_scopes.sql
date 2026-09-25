-- 0022 scrape scopes (docs/17): sweep, deep fetch, item fetch.

-- Which kind of run produced a row (§1). Local table.
ALTER TABLE ingestion_runs ADD COLUMN scope TEXT NOT NULL DEFAULT 'sweep' CHECK (scope IN ('sweep','deep','item'));

-- One JSON summary per finished or stopped sweep (§2.8).
ALTER TABLE ingestion_sweeps ADD COLUMN sweep_summary TEXT;

-- The probe's list hash per login and panel (§2.2). Local.
CREATE TABLE probe_state (
    login_ref   TEXT NOT NULL,
    panel       TEXT NOT NULL,
    list_hash   TEXT NOT NULL,
    rows        INTEGER NOT NULL,
    checked_at  TEXT NOT NULL,
    PRIMARY KEY (login_ref, panel)
);

-- Deep fetch requests (§2.4). Local: the collector runs them.
CREATE TABLE deep_fetch_requests (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL REFERENCES clients(id),
    depth         TEXT NOT NULL CHECK (depth IN ('all','years','since')),
    depth_value   TEXT,
    modules       TEXT NOT NULL,
    docs_policy   TEXT NOT NULL CHECK (docs_policy IN ('index','download')),
    mode          TEXT NOT NULL CHECK (mode IN ('tonight','now')),
    status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
    requested_by  TEXT,
    requested_at  TEXT NOT NULL,
    started_at    TEXT,
    finished_at   TEXT,
    progress      TEXT,
    last_error    TEXT
);
CREATE INDEX idx_deep_fetch_client ON deep_fetch_requests(client_id, status);

-- History depth, dormant tier and pause reason on the client (§2.4, §2.5, §6.2). Synced with the row.
ALTER TABLE clients ADD COLUMN history_depth TEXT NOT NULL DEFAULT 'recent' CHECK (history_depth IN ('recent','partial','full'));
ALTER TABLE clients ADD COLUMN history_fetched_at TEXT;
ALTER TABLE clients ADD COLUMN history_note TEXT;
ALTER TABLE clients ADD COLUMN cadence_tier TEXT NOT NULL DEFAULT 'nightly' CHECK (cadence_tier IN ('nightly','weekly'));
ALTER TABLE clients ADD COLUMN cadence_pinned INTEGER NOT NULL DEFAULT 0 CHECK (cadence_pinned IN (0, 1));
ALTER TABLE clients ADD COLUMN last_swept_at TEXT;
ALTER TABLE clients ADD COLUMN sync_pause_reason TEXT;
