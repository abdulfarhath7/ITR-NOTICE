-- 0019 per-client sync switch (docs/16 §7). A disabled client is skipped
-- by whole-book and module sweeps (and so by the scheduler); "Sync now" on
-- the client still runs it on request.

ALTER TABLE clients ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sync_enabled IN (0, 1));
