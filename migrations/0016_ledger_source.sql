-- 0016 which kind of write produced a ledger entry: a sweep (the collector's
-- whole-book run, publishable only under the lease) or a user action. The
-- relay accepts sweep changesets only from the lease holder (docs/04).

ALTER TABLE ledger ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','sweep'));
