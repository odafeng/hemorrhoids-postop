-- Replace naive adherence calculation with protocol-aware expected report days
-- POD 0-7: daily (8 days)
-- POD 8-14: every 2 days (even PODs: 8,10,12,14 = 4 days)
-- POD 15-30: ~twice a week (days where (d-15)%7 = 0 or 3 = ~5 days)
-- Max expected ≈ 17 reports over 30 days

CREATE OR REPLACE FUNCTION fn_expected_reports(current_pod INTEGER)
RETURNS INTEGER AS $$
DECLARE
  d INTEGER;
  cnt INTEGER := 0;
BEGIN
  FOR d IN 0..LEAST(current_pod, 30) LOOP
    IF d <= 7 THEN
      cnt := cnt + 1;
    ELSIF d <= 14 THEN
      IF d % 2 = 0 THEN cnt := cnt + 1; END IF;
    ELSIF d <= 30 THEN
      IF (d - 15) % 7 = 0 OR (d - 15) % 7 = 3 THEN cnt := cnt + 1; END IF;
    END IF;
  END LOOP;
  RETURN GREATEST(cnt, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Recreate view with protocol-aware adherence
DROP VIEW IF EXISTS v_adherence_summary;

CREATE VIEW v_adherence_summary AS
SELECT
    p.study_id,
    p.age, p.sex, p.surgery_type, p.surgery_date,
    COUNT(sr.id) AS total_reports,
    MAX(sr.pod) AS max_pod,
    fn_expected_reports(
      GREATEST(0, (CURRENT_DATE - p.surgery_date))::INTEGER
    ) AS expected_reports,
    LEAST(100, ROUND(
      COUNT(sr.id)::NUMERIC /
      fn_expected_reports(GREATEST(0, (CURRENT_DATE - p.surgery_date))::INTEGER) * 100
    , 1)) AS adherence_pct,
    MIN(sr.pain_nrs) AS min_pain,
    MAX(sr.pain_nrs) AS max_pain,
    ROUND(AVG(sr.pain_nrs), 1) AS avg_pain,
    BOOL_OR(a.id IS NOT NULL) AS had_alerts
FROM patients p
LEFT JOIN symptom_reports sr ON p.study_id = sr.study_id
LEFT JOIN alerts a ON p.study_id = a.study_id
WHERE p.study_status != 'withdrawn'
GROUP BY p.study_id, p.age, p.sex, p.surgery_type, p.surgery_date;
