-- 0007 documents: one polymorphic store for every leaf. Exactly one parent.
--
-- Bytes live in document_blobs, content-addressed by sha256, inside the
-- encrypted archive (D-008). A documents row is the index; the blob is the
-- record. Document-first storage means the blob is written before the row
-- that references it. A pending receipt (form-and-receipt pair rule) is a
-- row with state='pending' and no blob.

CREATE TABLE document_blobs (
    file_hash  TEXT PRIMARY KEY,                  -- sha256 hex of the bytes
    byte_size  INTEGER NOT NULL,
    bytes      BLOB NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE documents (
    id            TEXT PRIMARY KEY,
    parent_type   TEXT NOT NULL CHECK (parent_type IN
                  ('proceeding','communication','response','adjournment_request',
                   'demand','demand_response','payment','return','filed_form')),
    parent_id     TEXT NOT NULL,
    doc_kind      TEXT NOT NULL CHECK (doc_kind IN
                  ('communication','response','annexure','form','receipt','challan','order','intimation')),
    filename      TEXT,
    file_hash     TEXT REFERENCES document_blobs(file_hash),
    source_url    TEXT,
    fetched_at    TEXT,
    page_count    INTEGER,
    byte_size     INTEGER,
    state         TEXT NOT NULL DEFAULT 'stored' CHECK (state IN ('stored','pending','failed')),
    storage_path  TEXT,                           -- 'blob:<sha256>' in v1; NULL while pending
    verified_flag INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_documents_parent ON documents(parent_type, parent_id);
CREATE INDEX idx_documents_hash ON documents(file_hash);
