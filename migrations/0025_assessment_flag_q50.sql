-- 0025 Q50 answered B: rectification (154) and revision (263/264) count
-- as assessment proceedings too. Data only (docs/18 §10 seam).
UPDATE type_registry SET is_assessment = 1
 WHERE registry_name = 'proceeding_type' AND code IN ('rectification_154', 'revision_263');
