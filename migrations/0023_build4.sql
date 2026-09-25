-- 0023 Build 4 (docs/18): AO-viewed first sighting, the assessment flag,
-- and proceeding events (AO viewed, limitation changed).

-- §3.1 when this device first saw `ao_viewed_on` non-null. Set once by
-- intake, never overwritten. Synced with the row.
ALTER TABLE communications ADD COLUMN ao_viewed_first_seen_at TEXT;

-- §3.2 Viewed by AO and Limitation apply only to assessment proceedings.
-- The flag is data: which rows count is the seed below (Q50), read by the
-- UI and the export, never section strings.
ALTER TABLE type_registry ADD COLUMN is_assessment INTEGER NOT NULL DEFAULT 0 CHECK (is_assessment IN (0, 1));

-- Q50 default A: scrutiny (incl. faceless), reassessment, penalty, best
-- judgement. Change this list to change the answer.
UPDATE type_registry SET is_assessment = 1
 WHERE registry_name = 'proceeding_type'
   AND code IN ('scrutiny_assessment', 'faceless_assessment', 'reassessment_148', 'best_judgement_144', 'penalty');

-- §3.4 the two ledger event kinds. A ledger entry is a table upsert
-- (docs/03), so the events are rows of a synced table: `ao_viewed`
-- {ao_viewed_on, first_seen_at} on a communication; `limitation_changed`
-- {from, to, source} on a proceeding. Rows are immutable once written.
CREATE TABLE proceeding_events (
    id               TEXT PRIMARY KEY,
    proceeding_id    TEXT NOT NULL REFERENCES proceedings(id),
    communication_id TEXT REFERENCES communications(id),
    kind             TEXT NOT NULL CHECK (kind IN ('ao_viewed', 'limitation_changed')),
    payload          TEXT NOT NULL,                -- JSON
    at               TEXT NOT NULL,                -- when the change was seen or made
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_proceeding_events_proceeding ON proceeding_events(proceeding_id, at);
CREATE INDEX idx_proceeding_events_kind ON proceeding_events(kind, at);
