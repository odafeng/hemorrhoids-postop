-- Server-side alert engine: PL/pgSQL trigger function
-- Fires AFTER INSERT ON symptom_reports
-- Replicates all 5 alert rules from alerts.js with dedup

CREATE OR REPLACE FUNCTION fn_check_alerts()
RETURNS TRIGGER AS $$
DECLARE
    rec RECORD;
    v_pain_streak INT := 0;
    v_pain_broke BOOLEAN := FALSE;
    v_bleed_streak INT := 0;
    v_bleed_broke BOOLEAN := FALSE;
    v_bowel_streak INT := 0;
    v_bowel_broke BOOLEAN := FALSE;
    v_cnt INT;
BEGIN
    -- Walk last 7 reports (most recent first) for consecutive streaks
    FOR rec IN
        SELECT pain_nrs, bleeding, bowel, fever
        FROM symptom_reports
        WHERE study_id = NEW.study_id
        ORDER BY report_date DESC
        LIMIT 7
    LOOP
        -- Pain ≥ 8 consecutive (break on first non-match)
        IF NOT v_pain_broke THEN
            IF rec.pain_nrs >= 8 THEN v_pain_streak := v_pain_streak + 1;
            ELSE v_pain_broke := TRUE; END IF;
        END IF;

        -- Persistent bleeding consecutive
        IF NOT v_bleed_broke THEN
            IF rec.bleeding = '持續' THEN v_bleed_streak := v_bleed_streak + 1;
            ELSE v_bleed_broke := TRUE; END IF;
        END IF;

        -- No bowel consecutive
        IF NOT v_bowel_broke THEN
            IF rec.bowel = '未排' THEN v_bowel_streak := v_bowel_streak + 1;
            ELSE v_bowel_broke := TRUE; END IF;
        END IF;
    END LOOP;

    -- Rule 1: Pain ≥ 8 for 3+ consecutive days
    IF v_pain_streak >= 3 THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'high_pain' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'high_pain', 'danger',
                '疼痛分數 ≥ 8 已連續 ' || v_pain_streak || ' 天，建議聯絡醫療機構或回診評估。');
        END IF;
    END IF;

    -- Rule 2: Persistent bleeding 2+ consecutive
    IF v_bleed_streak >= 2 THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'persistent_bleeding' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'persistent_bleeding', 'danger',
                '已連續 ' || v_bleed_streak || ' 次回報持續性出血，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 3: Blood clot (single instance)
    IF NEW.bleeding = '血塊' THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'blood_clot' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'blood_clot', 'danger',
                '您回報了出血伴隨血塊，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 4: No bowel 3+ consecutive days
    IF v_bowel_streak >= 3 THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'no_bowel' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'no_bowel', 'warning',
                '已連續 ' || v_bowel_streak || ' 天未排便，建議聯絡醫療機構評估是否需要處置。');
        END IF;
    END IF;

    -- Rule 5: Fever
    IF NEW.fever = TRUE THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'fever' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'fever', 'danger',
                '您回報了發燒症狀，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_check_alerts ON symptom_reports;
CREATE TRIGGER trg_check_alerts
    AFTER INSERT ON symptom_reports
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_alerts();
