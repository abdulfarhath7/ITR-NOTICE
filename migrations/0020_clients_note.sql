-- 0020 a firm-authored free-text note on the client (docs/16 §7, the
-- Client 360 Notes tab). Synced with the client row.

ALTER TABLE clients ADD COLUMN note TEXT;
