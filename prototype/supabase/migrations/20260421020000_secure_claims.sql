-- Security fix: move role / study_id / surgeon_id from user_metadata → app_metadata
-- Rationale: user_metadata is user-writable (supabase.auth.updateUser).
-- Any authenticated researcher could UPDATE their own user_metadata.surgeon_id
-- and immediately pivot RLS access to another surgeon's patient data
-- (Codex review P1, 2026-04-21).
-- Also tighten surgical_records UPDATE WITH CHECK to re-validate the
-- patient-surgeon relationship, preventing a researcher from rewriting
-- study_id to another patient on their own row (Codex review P1 #2).

-- =====================================================
-- 1. Backfill app_metadata for all existing users
-- =====================================================
-- SECURITY: Only populate fields that are ABSENT from app_metadata.
-- CASE…THEN NULL + jsonb_strip_nulls ensures we never overwrite an
-- existing key, even if an attacker edited user_metadata before deploy.
-- Overwriting with `||` was the original bug: it would cement
-- user-controlled values into the trusted claim source used by RLS.
--
-- 'role' is whitelisted to the three known values. Any account whose
-- user_metadata contains an unknown role (e.g. an attempted escalation)
-- is left with no role in app_metadata and is treated as 'anon' by RLS
-- until an admin corrects it via the Supabase dashboard.
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
      'role',
        CASE
          WHEN u.raw_app_meta_data ? 'role'                               THEN NULL
          WHEN u.raw_user_meta_data->>'role' IN ('patient','researcher','pi')
            THEN u.raw_user_meta_data->>'role'
          ELSE NULL
        END,
      'study_id',
        CASE
          WHEN u.raw_app_meta_data ? 'study_id'                           THEN NULL
          ELSE u.raw_user_meta_data->>'study_id'
        END,
      'surgeon_id',
        CASE
          WHEN u.raw_app_meta_data ? 'surgeon_id'                         THEN NULL
          ELSE u.raw_user_meta_data->>'surgeon_id'
        END
    ))
WHERE
  (u.raw_user_meta_data ? 'role'       AND NOT u.raw_app_meta_data ? 'role')
  OR (u.raw_user_meta_data ? 'study_id'   AND NOT u.raw_app_meta_data ? 'study_id')
  OR (u.raw_user_meta_data ? 'surgeon_id' AND NOT u.raw_app_meta_data ? 'surgeon_id');

-- =====================================================
-- 2. Flip helpers to read from app_metadata ONLY
-- =====================================================
-- No fallback: any fallback to user_metadata re-opens the security hole.
-- Going forward, any onboarding (patient-onboard, researcher-invite)
-- MUST write these claims to app_metadata.
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'anon');
$$;

CREATE OR REPLACE FUNCTION get_user_study_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'study_id';
$$;

CREATE OR REPLACE FUNCTION get_user_surgeon_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'surgeon_id';
$$;

-- =====================================================
-- 3. Harden surgical_records UPDATE: re-verify patient-surgeon match
-- =====================================================
-- Previous policy let a researcher who owned a row change study_id to
-- a patient in another surgeon's cohort. Mirror the INSERT policy's
-- EXISTS check so UPDATE WITH CHECK also verifies the target patient
-- belongs to the caller's surgeon.
DROP POLICY IF EXISTS "researcher_update_own_surgeon" ON surgical_records;
CREATE POLICY "researcher_update_own_surgeon" ON surgical_records FOR UPDATE
  USING  (
    get_user_role()='researcher'
    AND (surgeon_id)::text = get_user_surgeon_id()
  )
  WITH CHECK (
    get_user_role()='researcher'
    AND (surgeon_id)::text = get_user_surgeon_id()
    AND EXISTS (
      SELECT 1 FROM patients p
      WHERE (p.study_id)::text = (surgical_records.study_id)::text
        AND (p.surgeon_id)::text = get_user_surgeon_id()
    )
  );
