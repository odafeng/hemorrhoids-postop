-- Security fix (Codex review P1, 2026-04-21):
-- 20260421b_secure_claims.sql backfilled raw_app_meta_data.{role,study_id,surgeon_id}
-- directly from raw_user_meta_data, which is user-writable. Any account that
-- tampered with user_metadata before the migration landed would have had those
-- untrusted values cemented into the trusted claim source now consumed by RLS
-- (potentially granting PI role or another surgeon's cohort scope).
--
-- This migration:
--   1. Strips role/study_id/surgeon_id from app_metadata for ALL existing users.
--   2. Re-derives them ONLY from server-owned data:
--        - patient:    study_invites.used_by_user_id  →  study_id
--                      patients.surgeon_id             →  surgeon_id
--        - PI:         hardcoded email 'odafeng@hotmail.com'  →  role='pi', surgeon_id='HSF'
--   3. Leaves researchers with NO promoted claims — they must be re-provisioned
--      through the researcher-invite Edge Function (which writes app_metadata
--      via service_role). There are zero live researcher accounts at deploy
--      time so this is safe.
--
-- After this runs, raw_user_meta_data still holds legacy copies but the RLS
-- helpers only read app_metadata, so they are inert.

-- =====================================================
-- 1. Wipe untrusted promotions from app_metadata
-- =====================================================
UPDATE auth.users
SET raw_app_meta_data = (raw_app_meta_data - 'role' - 'study_id' - 'surgeon_id')
WHERE (raw_app_meta_data ? 'role')
   OR (raw_app_meta_data ? 'study_id')
   OR (raw_app_meta_data ? 'surgeon_id');

-- =====================================================
-- 2a. Backfill PATIENT claims from study_invites + patients
-- =====================================================
-- study_invites is researcher-issued (service_role) and records which
-- auth user consumed which invite. patients.surgeon_id is assigned by
-- PI at enrollment. Both are server-owned.
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_strip_nulls(jsonb_build_object(
       'role',       'patient',
       'study_id',   si.study_id,
       'surgeon_id', p.surgeon_id
     ))
FROM study_invites si
LEFT JOIN patients p ON p.study_id = si.study_id
WHERE si.used_by_user_id = u.id
  AND si.status = 'used';

-- =====================================================
-- 2b. Backfill PI claim from hardcoded email
-- =====================================================
-- PI identity is determined by the email controlled at project creation,
-- not by anything a user can edit on their own account.
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', 'pi', 'surgeon_id', 'HSF')
WHERE email = 'odafeng@hotmail.com';
