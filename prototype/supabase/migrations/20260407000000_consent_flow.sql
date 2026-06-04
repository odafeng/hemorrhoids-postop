-- Add consent tracking to patients table (accessible by patient via RLS)
-- The pii_patients table already has consent fields but is PI-only access
-- We mirror consent_signed here so the client can check without PI permissions

ALTER TABLE patients ADD COLUMN IF NOT EXISTS consent_signed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS consent_date TIMESTAMPTZ;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS consent_signature_url TEXT;

-- Allow patients to update their own consent status
DROP POLICY IF EXISTS "patient_update_consent" ON patients;
CREATE POLICY "patient_update_consent" ON patients
  FOR UPDATE
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  )
  WITH CHECK (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );
