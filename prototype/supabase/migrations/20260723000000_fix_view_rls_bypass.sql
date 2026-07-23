-- SECURITY (P0): v_adherence_summary and v_symptom_timeline leaked the entire
-- study dataset to anyone holding the public anon key.
--
-- Postgres views run with the privileges of their OWNER unless security_invoker
-- is set. Both views are owned by postgres and were granted to `anon`, so RLS on
-- patients / symptom_reports never applied to them. Verified against production
-- on 2026-07-23 with a seeded row: the base tables correctly returned 0 rows to
-- an anonymous caller while the views returned study_id, age, sex, surgery_type,
-- surgery_date, pain_nrs, adherence and the full symptom timeline. The anon key
-- is public by design — it ships inside the JS bundle — so this was reachable by
-- anyone with the project URL.
--
-- Two independent fixes, either of which would close it; both applied so that
-- neither a future re-GRANT nor a view rebuild silently reopens the hole.

-- 1. Evaluate the views as the CALLER, so the RLS policies on the underlying
--    tables apply. Researchers then see exactly the cohort their policies
--    already scope them to on `patients` directly (surgeon-scoped), and the PI
--    continues to see everything.
ALTER VIEW v_adherence_summary SET (security_invoker = on);
ALTER VIEW v_symptom_timeline  SET (security_invoker = on);

-- 2. Unauthenticated callers have no business reading either view. Only
--    v_adherence_summary is used by the app at all (getAdherenceSummary, the
--    researcher dashboard); v_symptom_timeline has no client caller.
REVOKE ALL ON v_adherence_summary FROM anon;
REVOKE ALL ON v_symptom_timeline  FROM anon;

-- Keep the roles the app actually authenticates as.
GRANT SELECT ON v_adherence_summary TO authenticated, service_role;
GRANT SELECT ON v_symptom_timeline  TO authenticated, service_role;
