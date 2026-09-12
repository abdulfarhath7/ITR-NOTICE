-- 0011 the ingestion queue (task 4.2) and per-login session locks (4.5).
-- Local tables: never synced. A sweep groups the jobs of one operator
-- action; a job is one login per module with a resume cursor of the panels
-- already completed, so a killed process continues where it stopped.

CREATE TABLE ingestion_sweeps (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL,
    scope       TEXT NOT NULL,                    -- JSON: {"kind":"all"|"module"|"client", ...}
    status      TEXT NOT NULL CHECK (status IN ('running','paused','done','stopped','failed')),
    operator    TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE ingestion_jobs (
    id              TEXT PRIMARY KEY,
    sweep_id        TEXT NOT NULL REFERENCES ingestion_sweeps(id),
    login_ref       TEXT NOT NULL,                -- the PAN that logs in (own or AR)
    client_id       TEXT REFERENCES clients(id),  -- the client that login belongs to, if in the book
    module          TEXT NOT NULL CHECK (module IN ('proceedings','demands','returns','forms')),
    position        INTEGER NOT NULL,
    status          TEXT NOT NULL CHECK (status IN
                    ('queued','running','awaiting_operator','done','incomplete','failed','parked','cancelled')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    cursor          TEXT,                         -- JSON: {"panels_done":[...]}
    last_error      TEXT,
    started_at      TEXT,
    finished_at     TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ingestion_jobs_sweep ON ingestion_jobs(sweep_id, position);
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_client ON ingestion_jobs(client_id);

-- One live portal session per taxpayer. Local now; the relay arbitrates
-- the same lock across devices in Phase 7.
CREATE TABLE session_locks (
    login_ref   TEXT PRIMARY KEY,
    holder      TEXT NOT NULL,                    -- device id
    acquired_at TEXT NOT NULL,
    expires_at  TEXT NOT NULL
);
