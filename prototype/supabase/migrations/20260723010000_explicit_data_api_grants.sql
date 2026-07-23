-- Make the Data API grants explicit instead of relying on Supabase auto-exposing
-- new objects in `public`.
--
-- config.toml documents that `auto_expose_new_tables` flips to false on
-- 2026-05-30 and that the setting disappears entirely on 2026-10-30, once
-- "always revoked" is permanent. CI started failing on 2026-07-23 with
-- `permission denied for table patients` during E2E seeding, because
-- supabase/setup-cli@v1 pins `version: latest` and picked up a CLI past the
-- flip: migrations create the tables, nothing grants them, and even the
-- service_role key cannot read them.
--
-- Production predates the flip so its grants already exist and this migration is
-- a no-op there — but any table added by a FUTURE migration would have hit the
-- same wall in production, silently, at deploy time. Declaring the grants here
-- removes the dependency on CLI-version-dependent implicit behaviour.
--
-- SAFETY: every table in `public` has RLS enabled (verified 2026-07-23: 17/17),
-- so these grants do not by themselves expose any row — RLS policies remain the
-- only thing deciding visibility. This mirrors Supabase's own default grants.
-- VIEWS ARE DELIBERATELY EXCLUDED: a view without security_invoker runs as its
-- owner and bypasses the RLS of its base tables, which is exactly how
-- v_adherence_summary / v_symptom_timeline leaked (see the previous migration).
-- View privileges are granted explicitly, per view, alongside security_invoker.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Anything created later by the migration runner.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- Re-apply the view lockdown: `GRANT ALL ON ALL TABLES` above also covers views,
-- so this must run after it or the leak reopens on every fresh database.
REVOKE ALL ON v_adherence_summary FROM anon;
REVOKE ALL ON v_symptom_timeline  FROM anon;
GRANT SELECT ON v_adherence_summary TO authenticated, service_role;
GRANT SELECT ON v_symptom_timeline  TO authenticated, service_role;
