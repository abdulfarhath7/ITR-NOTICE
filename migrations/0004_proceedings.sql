-- 0004 proceedings: one table for assessments, appeals and standalone letter
-- shells. Category comes from type_registry (docs/02-data-model.md).
--
-- limitation_date is the statutory clock and the field partners track; it is
-- not the response deadline (due_date). Both are portal-stated or NULL with a
-- gap flag — never inferred.

CREATE TABLE proceedings (
    id                     TEXT PRIMARY KEY,
    year_context_id        TEXT NOT NULL REFERENCES year_contexts(id),
    proceeding_type_id     TEXT NOT NULL REFERENCES type_registry(id),
    -- Source-independent identity: sha256 over (pan, assessment_year,
    -- source_panel, display_name). The same proceeding fetched by the
    -- scraper and later by the ERI API produces the same key.
    natural_key            TEXT NOT NULL UNIQUE,
    display_name           TEXT,                  -- the portal's "Proceeding Name"
    assessee_name          TEXT,                  -- name on the proceeding; differs for AR cases
    section_2025           TEXT,
    section_1961           TEXT,
    din_reference          TEXT,
    authority              TEXT,
    initiated_on           TEXT,                  -- YYYY-MM-DD
    due_date               TEXT,                  -- portal-stated response due date
    manual_due_date        TEXT,                  -- user-entered; fills a blank only (Q14)
    suggested_due_date     TEXT,                  -- AI; never promoted automatically
    limitation_date        TEXT,
    hearing_date           TEXT,                  -- room for Q13, no UI yet
    status                 TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (status IN ('open','adjournment_sought','response_submitted','closed','unknown')),
    portal_status          TEXT,                  -- the portal's own word, kept as evidence
    closure_date           TEXT,
    closure_order          TEXT,
    source_panel           TEXT NOT NULL
                           CHECK (source_panel IN ('self:action','self:information',
                                                   'other_pan:action','other_pan:information',
                                                   'auth_rep:action','auth_rep:information')),
    created_mode           TEXT NOT NULL DEFAULT 'auto' CHECK (created_mode IN ('auto','manual')),
    appeal_number          TEXT,
    order_appealed_against TEXT,
    verified_flag          INTEGER NOT NULL DEFAULT 0,
    gap_flags              TEXT,                  -- JSON array of column names the portal did not show
    row_hash               TEXT NOT NULL,         -- delta detection; includes status and gap_flags
    first_seen_at          TEXT NOT NULL,
    last_seen_at           TEXT NOT NULL,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_proceedings_year_context ON proceedings(year_context_id);
CREATE INDEX idx_proceedings_type ON proceedings(proceeding_type_id);
CREATE INDEX idx_proceedings_status ON proceedings(status);
CREATE INDEX idx_proceedings_due ON proceedings(due_date);
CREATE INDEX idx_proceedings_limitation ON proceedings(limitation_date);
CREATE INDEX idx_proceedings_din ON proceedings(din_reference);
