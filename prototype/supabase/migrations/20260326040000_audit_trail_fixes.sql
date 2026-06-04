-- Fix audit_trail:
-- 1. Ensure audit_trail table exists (may not if 20260323 migration was applied via SQL editor)
-- 2. Allow INSERT from all authenticated roles (patients, researchers, PI)
-- 3. Report audit trigger should fire on INSERT OR UPDATE (matches alert trigger fix)

---------------------------------------------------------------------
-- 0. Ensure audit_trail + pending_notifications tables exist
--    (may be missing if 20260323_notifications_audit was applied via SQL editor or partially)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_trail (
    id          SERIAL PRIMARY KEY,
    actor_id    UUID,
    actor_role  VARCHAR(20),
    action      VARCHAR(50) NOT NULL,
    resource    VARCHAR(50),
    resource_id TEXT,
    detail      JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS pending_notifications (
    id          SERIAL PRIMARY KEY,
    study_id    VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    type        VARCHAR(30) NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patients_own_notifications" ON pending_notifications;
CREATE POLICY "patients_own_notifications" ON pending_notifications
    FOR ALL USING (study_id = get_user_study_id());

-- Ensure base read policy exists
DROP POLICY IF EXISTS "researcher_read_audit" ON audit_trail;
CREATE POLICY "researcher_read_audit" ON audit_trail
    FOR SELECT USING (get_user_role() IN ('researcher', 'pi'));

---------------------------------------------------------------------
-- 1. RLS: all authenticated users can INSERT audit entries
---------------------------------------------------------------------
DROP POLICY IF EXISTS "all_roles_insert_audit" ON audit_trail;
CREATE POLICY "all_roles_insert_audit" ON audit_trail
    FOR INSERT
    WITH CHECK (get_user_role() IN ('patient', 'researcher', 'pi'));

---------------------------------------------------------------------
-- 2. Ensure audit functions exist (may be missing if 20260323/25 never ran)
---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_audit_report_submit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_trail (actor_id, actor_role, action, resource, resource_id, detail)
  VALUES (
    auth.uid(),
    'patient',
    'report.submit',
    'symptom_reports',
    NEW.study_id,
    jsonb_build_object(
      'report_date', NEW.report_date,
      'pain_nrs', NEW.pain_nrs,
      'pod', NEW.pod
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_audit_alert_create()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_trail (actor_id, actor_role, action, resource, resource_id, detail)
  VALUES (
    NULL,
    'system',
    'alert.create',
    'alerts',
    NEW.study_id,
    jsonb_build_object(
      'alert_type', NEW.alert_type,
      'alert_level', NEW.alert_level,
      'message', NEW.message
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

---------------------------------------------------------------------
-- 3. Report audit trigger: INSERT OR UPDATE
---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_report ON symptom_reports;

CREATE TRIGGER trg_audit_report
    AFTER INSERT OR UPDATE ON symptom_reports
    FOR EACH ROW EXECUTE FUNCTION fn_audit_report_submit();

-- Ensure alert audit trigger exists too
DROP TRIGGER IF EXISTS trg_audit_alert ON alerts;
CREATE TRIGGER trg_audit_alert
    AFTER INSERT ON alerts
    FOR EACH ROW EXECUTE FUNCTION fn_audit_alert_create();
