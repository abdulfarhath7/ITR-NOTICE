-- 0013 modules 2, 3 and 4: outstanding demands with the firm's stance and
-- payments; filed returns chained by supersedes_id; filed forms grouped by
-- form type from the registry (docs/02-data-model.md, Phase 5).

CREATE TABLE demands (
    id                      TEXT PRIMARY KEY,
    year_context_id         TEXT NOT NULL REFERENCES year_contexts(id),
    natural_key             TEXT NOT NULL UNIQUE,       -- sha256(pan | demand_reference_number)
    demand_reference_number TEXT,
    demand_amount           REAL,
    current_outstanding     REAL,                        -- a different number; both kept
    section_or_demand_type  TEXT,
    raised_on               TEXT,
    uploaded_by             TEXT,
    rectification_rights    TEXT,
    status                  TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (status IN ('open','adjournment_sought','response_submitted','closed','unknown')),
    portal_status           TEXT,
    proceeding_id           TEXT REFERENCES proceedings(id),
    verified_flag           INTEGER NOT NULL DEFAULT 0,
    gap_flags               TEXT,
    row_hash                TEXT NOT NULL,
    first_seen_at           TEXT NOT NULL,
    last_seen_at            TEXT NOT NULL,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_demands_year_context ON demands(year_context_id);
CREATE INDEX idx_demands_proceeding ON demands(proceeding_id);
CREATE INDEX idx_demands_status ON demands(status);

CREATE TABLE demand_responses (
    id              TEXT PRIMARY KEY,
    demand_id       TEXT NOT NULL REFERENCES demands(id),
    stance          TEXT CHECK (stance IN ('agreed','disagreed','partially_disagreed')),
    reason_code_id  TEXT REFERENCES type_registry(id),
    disputed_amount REAL,
    filed_on        TEXT,
    transaction_id  TEXT,
    verified_flag   INTEGER NOT NULL DEFAULT 0,
    gap_flags       TEXT,
    row_hash        TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_demand_responses_demand ON demand_responses(demand_id);
CREATE INDEX idx_demand_responses_reason ON demand_responses(reason_code_id);

-- The year context is the parent (Q03); the two links are relationships.
CREATE TABLE payments (
    id                 TEXT PRIMARY KEY,
    year_context_id    TEXT NOT NULL REFERENCES year_contexts(id),
    demand_response_id TEXT REFERENCES demand_responses(id),
    proceeding_id      TEXT REFERENCES proceedings(id),
    purpose            TEXT NOT NULL DEFAULT 'other'
                       CHECK (purpose IN ('demand_settlement','pre_deposit','self_assessment','other')),
    cin                TEXT,
    bsr_code           TEXT,
    paid_on            TEXT,
    amount             REAL,
    verified_flag      INTEGER NOT NULL DEFAULT 0,
    gap_flags          TEXT,
    row_hash           TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_payments_year_context ON payments(year_context_id);
CREATE INDEX idx_payments_demand_response ON payments(demand_response_id);
CREATE INDEX idx_payments_proceeding ON payments(proceeding_id);

-- Revised and updated returns are siblings chained by supersedes_id.
CREATE TABLE returns (
    id                     TEXT PRIMARY KEY,
    year_context_id        TEXT NOT NULL REFERENCES year_contexts(id),
    acknowledgement_number TEXT NOT NULL UNIQUE,
    return_type            TEXT,                        -- ITR-1 ... ITR-7
    filing_type            TEXT CHECK (filing_type IN ('original','revised','updated')),
    filed_on               TEXT,
    verification_status    TEXT,
    processing_status      TEXT,
    status                 TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (status IN ('open','adjournment_sought','response_submitted','closed','unknown')),
    supersedes_id          TEXT REFERENCES returns(id),
    verified_flag          INTEGER NOT NULL DEFAULT 0,
    gap_flags              TEXT,
    row_hash               TEXT NOT NULL,
    first_seen_at          TEXT NOT NULL,
    last_seen_at           TEXT NOT NULL,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_returns_year_context ON returns(year_context_id);
CREATE INDEX idx_returns_supersedes ON returns(supersedes_id);

CREATE TABLE filed_forms (
    id                     TEXT PRIMARY KEY,
    year_context_id        TEXT NOT NULL REFERENCES year_contexts(id),
    form_type_id           TEXT NOT NULL REFERENCES type_registry(id),
    acknowledgement_number TEXT NOT NULL UNIQUE,
    form_label             TEXT,                        -- the portal's own words for the form
    filed_on               TEXT,
    filing_type            TEXT,
    portal_status          TEXT,
    status                 TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (status IN ('open','adjournment_sought','response_submitted','closed','unknown')),
    filed_by               TEXT,
    verified_flag          INTEGER NOT NULL DEFAULT 0,
    gap_flags              TEXT,
    row_hash               TEXT NOT NULL,
    first_seen_at          TEXT NOT NULL,
    last_seen_at           TEXT NOT NULL,
    created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_filed_forms_year_context ON filed_forms(year_context_id);
CREATE INDEX idx_filed_forms_type ON filed_forms(form_type_id);
