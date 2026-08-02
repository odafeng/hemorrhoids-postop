-- v_adherence_summary: fix a join fan-out, and align the schedule with the protocol
-- the PI confirmed on 2026-08-02.
--
-- Two problems, both hitting adherence — a primary feasibility outcome.
--
-- 1. Join fan-out. The view LEFT JOINed both symptom_reports and alerts off patients.
--    Two independent one-to-many joins multiply: every report row was repeated once
--    per alert. Production read total_reports = 24 for HSF-001 against 8 actual
--    reports, and adherence_pct = 240%. The inflation factor was each patient's alert
--    count, so patients with more alerts scored as *more* adherent — a systematic
--    bias, not noise. alerts is only needed for had_alerts, so it becomes EXISTS.
--    (avg/min/max pain survived, since uniform duplication leaves them unchanged.)
--
-- 2. Schedule. fn_expected_reports encoded 第三週起每週約 2 次 and week 2 on even PODs
--    (8/10/12/14), totalling ~17 reports. The PI confirmed the protocol on 2026-08-02
--    as 第一週每日、第二週每兩日一次、第三週起每週一次. Week 2 now counts +2 days from
--    the last daily report (POD 7) → 9/11/13, and week 3+ counts +7 from POD 13
--    → 20/27, totalling 13 over 30 days. The consent form says 第 15–30 天每週 1–2 次,
--    so weekly is the conservative end of what the subject agreed to.
--
-- Note this function and view were written in 20260326060000_protocol_adherence.sql but
-- never reached production — the migration history is desynced from prod, which is why
-- prod still ran the naive max(pod)+1 denominator. Superseding it here.
--
-- DROP + CREATE rather than CREATE OR REPLACE: the latter cannot insert or reorder
-- columns, and prod's column order had already diverged from this chain's. Dropping
-- discards grants and reloptions, so both are restated below — security_invoker keeps
-- the view under the caller's RLS (added 2026-07-23 after the view-RLS-bypass finding),
-- and anon must stay revoked.

CREATE OR REPLACE FUNCTION fn_expected_reports(current_pod INTEGER)
RETURNS INTEGER AS $$
DECLARE
  d INTEGER;
  cnt INTEGER := 0;
BEGIN
  FOR d IN 0..LEAST(current_pod, 30) LOOP
    IF d <= 7 THEN
      cnt := cnt + 1;                                              -- 第一週：每日
    ELSIF d <= 14 THEN
      IF (d - 7) % 2 = 0 THEN cnt := cnt + 1; END IF;              -- 第二週：POD 9/11/13
    ELSE
      IF (d - 13) % 7 = 0 THEN cnt := cnt + 1; END IF;             -- 第三週起：POD 20/27
    END IF;
  END LOOP;
  RETURN GREATEST(cnt, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP VIEW IF EXISTS v_adherence_summary;

CREATE VIEW v_adherence_summary
WITH (security_invoker = on) AS
SELECT
    p.study_id,
    p.age,
    p.sex,
    p.surgery_type,
    p.surgery_date,
    COUNT(sr.id)                                        AS total_reports,
    MAX(sr.pod)                                         AS max_pod,
    -- Driven by elapsed days, not MAX(sr.pod): keying off the last report scored a
    -- subject who stopped on POD 3 while sitting at POD 20 as 100% adherent, which is
    -- precisely the dropout this measure exists to catch.
    fn_expected_reports(GREATEST(0, CURRENT_DATE - p.surgery_date)::INTEGER)
                                                        AS expected_reports,
    LEAST(100, ROUND(
        COUNT(sr.id)::NUMERIC
        / fn_expected_reports(GREATEST(0, CURRENT_DATE - p.surgery_date)::INTEGER)
        * 100, 1))                                      AS adherence_pct,
    MIN(sr.pain_nrs)                                    AS min_pain,
    MAX(sr.pain_nrs)                                    AS max_pain,
    ROUND(AVG(sr.pain_nrs), 1)                          AS avg_pain,
    EXISTS (SELECT 1 FROM alerts a
             WHERE a.study_id::text = p.study_id::text) AS had_alerts,
    GREATEST(0, LEAST(CURRENT_DATE - p.surgery_date, 30))::INTEGER
                                                        AS days_since_surgery
FROM patients p
LEFT JOIN symptom_reports sr ON p.study_id::text = sr.study_id::text
WHERE p.study_status::text <> 'withdrawn'::text
GROUP BY p.study_id, p.age, p.sex, p.surgery_type, p.surgery_date;

REVOKE ALL ON v_adherence_summary FROM anon;
GRANT SELECT ON v_adherence_summary TO authenticated, service_role;
