-- One definition of the follow-up schedule, callable from SQL and from Edge Functions.
--
-- The protocol (confirmed by the PI 2026-08-02): 第一週每日、第二週每兩日一次、
-- 第三週起每週一次 → POD 0-7, then 9/11/13, then 20/27. 13 report days over 30.
--
-- Why a function rather than the rule inlined at each call site: the same schedule is
-- needed by the adherence denominator and by the daily reminder cron. Today already
-- produced two bugs caused by one rule living in two places (the alert engine in JS and
-- PL/pgSQL, and the adherence view on disk vs in prod), so fn_expected_reports is
-- rebuilt on top of this and check-adherence reads it over RPC instead of carrying a
-- third copy in TypeScript.

CREATE OR REPLACE FUNCTION fn_report_days()
RETURNS SETOF INTEGER AS $$
  SELECT d
  FROM generate_series(0, 30) AS d
  WHERE CASE
          WHEN d <= 7  THEN TRUE                 -- 第一週：每日
          WHEN d <= 14 THEN (d - 7) % 2 = 0      -- 第二週：POD 9/11/13
          ELSE              (d - 13) % 7 = 0     -- 第三週起：POD 20/27
        END;
$$ LANGUAGE sql IMMUTABLE;

-- Derived, so the denominator can never drift from the reminder schedule.
CREATE OR REPLACE FUNCTION fn_expected_reports(current_pod INTEGER)
RETURNS INTEGER AS $$
  SELECT GREATEST(COUNT(*), 1)::INTEGER
  FROM fn_report_days() AS d
  WHERE d <= LEAST(current_pod, 30);
$$ LANGUAGE sql IMMUTABLE;

GRANT EXECUTE ON FUNCTION fn_report_days() TO service_role;
