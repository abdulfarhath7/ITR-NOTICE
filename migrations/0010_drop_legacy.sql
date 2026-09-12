-- 0010 drop the pre-build tables. Their rows were carried into the spine by
-- 0009, which refuses unless every count reconciles, so by the time this
-- runs nothing in them is unaccounted for. Runs only after the app was
-- confirmed green on the new read paths (task 1.9).

DROP TABLE legacy_drafts;
DROP TABLE legacy_notices;
DROP TABLE legacy_proceedings;
DROP TABLE legacy_runs;
