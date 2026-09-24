-- 0017 per-item metadata a person authors: who owns it and a free-text
-- note (docs/16 §2.2). Never written by the scraper. One row per
-- (module, item_id); the id is `module:item_id` so the row keys the same
-- way on every device and travels through the ledger like any other.

CREATE TABLE work_item_meta (
    id          TEXT PRIMARY KEY,                -- 'module:item_id'
    module      TEXT NOT NULL CHECK (module IN ('proceedings','demands','returns','forms')),
    item_id     TEXT NOT NULL,
    assignee    TEXT,                            -- display name, free text, no user table
    note        TEXT,
    updated_by  TEXT,                            -- device id; masked in logs
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (module, item_id)
);
