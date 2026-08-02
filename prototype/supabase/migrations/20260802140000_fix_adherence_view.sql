-- v_adherence_summary: fix a join fan-out and use the consented follow-up schedule.
--
-- Two defects, both affecting adherence — a primary feasibility outcome.
--
-- 1. Fan-out. The view LEFT JOINed both symptom_reports and alerts off patients,
--    so every report row was multiplied by that patient's alert count.
--    HSF-001 read total_reports = 24 (actually 8) and adherence_pct = 240%.
--    The inflation factor was each patient's alert count, so patients with more
--    alerts looked *more* adherent — a systematic bias, not just noise.
--    alerts is only needed for had_alerts, so it becomes an EXISTS subquery.
--
-- 2. Denominator. It was max(pod) + 1, i.e. a report expected every single day.
--    The consent form (ConsentPage.jsx) states the schedule the subject agreed to:
--    週1 每日, 週2 每兩日一次, 週3 起每週一次. Confirmed by the PI 2026-08-02.
--    Encoded as: POD 0-7 daily (8) → POD 9,11,13 (3) → POD 20,27 (2) = 13 over 30 days.
--    Interpretation to be aware of: week 2 counts +2 days from the last daily report
--    (POD 7), landing on 9/11/13 rather than 8/10/12/14; week 3+ counts +7 from POD 13.
--
--    Expected is now driven by days elapsed since surgery, not by max(pod). Under the
--    old formula a subject who stopped reporting on POD 3 while sitting at POD 20
--    scored 100%; that is exactly the dropout an adherence measure must catch.
--
-- security_invoker = on is restated deliberately — it is what keeps the view under the
-- caller's RLS (patched 2026-07-26 after the view-RLS-bypass audit finding), and
-- CREATE OR REPLACE does not carry reloptions forward on its own.
--
-- New columns are appended, never inserted: CREATE OR REPLACE VIEW cannot reorder or
-- rename existing columns. Frontend reads via select('*') by name, so this is additive.
--
-- HAND-APPLIED to production 2026-08-02 via the Management API (migration history is
-- desynced from prod; db push would replay everything). Verified after apply:
-- HSF-001 total_reports 8, expected 9, adherence 88.9%, security_invoker still on.
CREATE OR REPLACE VIEW public.v_adherence_summary
WITH (security_invoker = on) AS
SELECT
    p.study_id,
    p.age,
    p.sex,
    p.surgery_type,
    p.surgery_date,
    count(sr.id)                               AS total_reports,
    max(sr.pod)                                AS max_pod,
    round(count(sr.id)::numeric
          / GREATEST(e.expected, 1)::numeric * 100::numeric, 1) AS adherence_pct,
    min(sr.pain_nrs)                           AS min_pain,
    max(sr.pain_nrs)                           AS max_pain,
    round(avg(sr.pain_nrs), 1)                 AS avg_pain,
    EXISTS (SELECT 1 FROM alerts a WHERE a.study_id::text = p.study_id::text) AS had_alerts,
    e.pod_now                                  AS days_since_surgery,
    e.expected                                 AS expected_reports
FROM patients p
LEFT JOIN symptom_reports sr ON p.study_id::text = sr.study_id::text
CROSS JOIN LATERAL (
    SELECT d.pod_now,
           ( LEAST(d.pod_now, 7) + 1
           + GREATEST(0, FLOOR((LEAST(d.pod_now, 14) - 7) / 2.0))
           + GREATEST(0, FLOOR((LEAST(d.pod_now, 30) - 13) / 7.0)) )::integer AS expected
    FROM (SELECT GREATEST(LEAST(CURRENT_DATE - p.surgery_date, 30), 0) AS pod_now) d
) e
WHERE p.study_status::text <> 'withdrawn'::text
GROUP BY p.study_id, p.age, p.sex, p.surgery_type, p.surgery_date, e.pod_now, e.expected;
