-- Fix audit triggers that reference non-existent columns
-- fn_audit_report_submit: NEW.post_op_day → NEW.pod
-- fn_audit_alert_create: NEW.severity → NEW.alert_level

-- Fix 1: Report audit trigger
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

-- Fix 2: Alert audit trigger
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
