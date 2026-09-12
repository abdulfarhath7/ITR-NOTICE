-- 0001 baseline: the schema the desktop app shipped with before migrations
-- existed (src-tauri/src/db.rs, mirrored from app/db.py). IF NOT EXISTS so an
-- archive created by that code adopts version 1 cleanly. Later migrations
-- replace these tables with the work-item spine in docs/02-data-model.md.

CREATE TABLE IF NOT EXISTS proceedings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tab             TEXT NOT NULL,
    sub_tab         TEXT NOT NULL,
    proceeding_name TEXT,
    pan             TEXT,
    assessee_name   TEXT,
    assessment_year TEXT,
    financial_year  TEXT,
    applicable_act  TEXT,
    status          TEXT,
    closure_date    TEXT,
    closure_order   TEXT,
    first_seen      TEXT DEFAULT (datetime('now')),
    last_seen       TEXT DEFAULT (datetime('now')),
    UNIQUE(tab, sub_tab, proceeding_name, pan, assessment_year)
);

CREATE TABLE IF NOT EXISTS notices (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    proceeding_id   INTEGER REFERENCES proceedings(id),
    ref_id          TEXT UNIQUE,
    notice_us       TEXT,
    doc_ref_id      TEXT,
    description     TEXT,
    issued_on       TEXT,
    served_on       TEXT,
    due_date        TEXT,
    due_date_source TEXT,
    due_date_basis  TEXT,
    ao_viewed_on    TEXT,
    responded       INTEGER,
    pdf_blob        BLOB,
    downloaded_at   TEXT,
    first_seen      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drafts (
    ref_id         TEXT PRIMARY KEY,
    generated_at   TEXT DEFAULT (datetime('now')),
    summary        TEXT,
    checklist_json TEXT,
    draft_text     TEXT
);

CREATE TABLE IF NOT EXISTS runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started        TEXT DEFAULT (datetime('now')),
    finished       TEXT,
    status         TEXT DEFAULT 'running',
    message        TEXT,
    notices_new    INTEGER,
    pdfs_saved     INTEGER,
    skipped_cached INTEGER
);
