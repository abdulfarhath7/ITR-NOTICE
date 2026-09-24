-- 0018 a person marks a draft reviewed (docs/16 §2.3). Cleared when the
-- draft is regenerated. Drives the "Drafts to review" tile.

ALTER TABLE drafts ADD COLUMN reviewed_at TEXT;
