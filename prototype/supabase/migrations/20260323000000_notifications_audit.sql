-- Notification infrastructure: push subscriptions + pending notifications
-- Audit trail for all critical operations

---------------------------------------------------------------------
-- 1. Push Subscriptions (Web Push API registrations)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          SERIAL PRIMARY KEY,
    study_id    VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    endpoint    TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(study_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients own subs" ON push_subscriptions
  FOR ALL USING (
    study_id = current_setting('request.jwt.claims', true)::json->>'study_id'
  );

---------------------------------------------------------------------
-- 2. Pending Notifications (server-driven, checked by frontend on open)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pending_notifications (
    id          SERIAL PRIMARY KEY,
    study_id    VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    type        VARCHAR(30) NOT NULL, -- 'reminder', 'alert', 'info'
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pending_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patients own notifications" ON pending_notifications
  FOR ALL USING (
    study_id = current_setting('request.jwt.claims', true)::json->>'study_id'
  );

---------------------------------------------------------------------
-- 3. Audit Trail (all critical operations)
---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_trail (
    id          SERIAL PRIMARY KEY,
    actor_id    UUID,          -- auth.uid() or NULL for system
    actor_role  VARCHAR(20),   -- patient, researcher, pi, system
    action      VARCHAR(50) NOT NULL, -- 'report.submit', 'alert.create', 'pii.access', etc.
    resource    VARCHAR(50),   -- table name or resource
    resource_id TEXT,          -- study_id or record id
    detail      JSONB,         -- action-specific data
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_trail ENABLE ROW LEVEL SECURITY;

-- Only researchers/PI can read audit trail
CREATE POLICY "researcher_read_audit" ON audit_trail
  FOR SELECT USING (
    get_user_role() IN ('researcher', 'pi')
  );

---------------------------------------------------------------------
-- 4. Auto-audit report submissions via trigger
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
      'pod', NEW.post_op_day
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_report ON symptom_reports;
CREATE TRIGGER trg_audit_report
  AFTER INSERT ON symptom_reports
  FOR EACH ROW EXECUTE FUNCTION fn_audit_report_submit();

---------------------------------------------------------------------
-- 5. Auto-audit alert creation via trigger
---------------------------------------------------------------------
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
      'severity', NEW.severity,
      'message', NEW.message
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_audit_alert ON alerts;
CREATE TRIGGER trg_audit_alert
  AFTER INSERT ON alerts
  FOR EACH ROW EXECUTE FUNCTION fn_audit_alert_create();


