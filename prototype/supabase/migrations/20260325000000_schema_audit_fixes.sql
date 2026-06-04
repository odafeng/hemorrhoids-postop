-- Fix 3 issues found during schema audit
-- 1. v_symptom_timeline view missing urinary + continence
-- 2. fn_audit_report_submit references NEW.post_op_day (should be NEW.pod)
-- 3. fn_audit_alert_create references NEW.severity (should be NEW.alert_level)

---------------------------------------------------------------------
-- Fix 1: Update v_symptom_timeline view to include new columns
---------------------------------------------------------------------
DROP VIEW IF EXISTS v_symptom_timeline;

CREATE VIEW v_symptom_timeline AS
SELECT
    sr.study_id,
    p.age, p.sex, p.surgery_type, p.hemorrhoid_grade,
    sr.report_date, sr.pod,
    sr.pain_nrs, sr.bleeding, sr.bowel, sr.fever, sr.wound,
    sr.urinary, sr.continence
FROM symptom_reports sr
JOIN patients p ON sr.study_id = p.study_id
WHERE p.study_status != 'withdrawn'
ORDER BY sr.study_id, sr.pod;

---------------------------------------------------------------------
-- Fix 2: fn_audit_report_submit — post_op_day → pod
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

---------------------------------------------------------------------
-- Fix 3: fn_audit_alert_create — severity → alert_level
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
      'alert_level', NEW.alert_level,
      'message', NEW.message
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
