-- 0008 ingestion_runs: the audit of every sweep. A panel that found nothing
-- writes a row with records_found = 0 — zero is a finding.
-- Also drafts, re-keyed to the new communications table so the legacy
-- backfill (0009) loses nothing.

CREATE TABLE ingestion_runs (
    id            TEXT PRIMARY KEY,
    run_at        TEXT NOT NULL,
    device_id     TEXT NOT NULL,
    client_id     TEXT REFERENCES clients(id),    -- NULL only when a run failed before any client
    module        TEXT NOT NULL CHECK (module IN ('proceedings','demands','returns','forms')),
    panel_swept   TEXT,
    records_found INTEGER NOT NULL DEFAULT 0,
    gaps          TEXT,                           -- JSON
    operator      TEXT,
    status        TEXT NOT NULL CHECK (status IN ('ok','incomplete','failed','credentials_parked','awaiting_operator')),
    notes         TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ingestion_runs_client ON ingestion_runs(client_id, run_at);
CREATE INDEX idx_ingestion_runs_run_at ON ingestion_runs(run_at);

CREATE TABLE drafts (
    id               TEXT PRIMARY KEY,
    communication_id TEXT NOT NULL UNIQUE REFERENCES communications(id),
    generated_at     TEXT,
    model            TEXT,
    summary          TEXT,
    checklist_json   TEXT,
    draft_text       TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
