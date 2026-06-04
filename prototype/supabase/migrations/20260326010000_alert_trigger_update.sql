-- Fix: alert trigger must fire on UPDATE too
-- saveReport() uses upsert(study_id, report_date), so same-day edits
-- are UPDATE operations that currently skip alert re-evaluation.

DROP TRIGGER IF EXISTS trg_check_alerts ON symptom_reports;

CREATE TRIGGER trg_check_alerts
    AFTER INSERT OR UPDATE ON symptom_reports
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_alerts();
