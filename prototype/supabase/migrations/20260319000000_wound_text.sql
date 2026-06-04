-- Fix wound column: VARCHAR(20) is too narrow for multi-select values
-- Must drop/recreate dependent view first

DROP VIEW IF EXISTS v_symptom_timeline;

ALTER TABLE symptom_reports ALTER COLUMN wound TYPE TEXT;

-- Recreate view
CREATE VIEW v_symptom_timeline AS
SELECT
    sr.study_id,
    p.age, p.sex, p.surgery_type, p.hemorrhoid_grade,
    sr.report_date, sr.pod,
    sr.pain_nrs, sr.bleeding, sr.bowel, sr.fever, sr.wound
FROM symptom_reports sr
JOIN patients p ON sr.study_id = p.study_id
WHERE p.study_status != 'withdrawn'
ORDER BY sr.study_id, sr.pod;
