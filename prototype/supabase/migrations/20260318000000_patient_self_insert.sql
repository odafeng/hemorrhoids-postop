-- Allow patients to insert their own record (auto-creation on first login)
CREATE POLICY "patient_insert_own" ON patients
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );
