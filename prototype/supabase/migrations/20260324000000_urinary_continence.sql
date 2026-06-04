-- Add urinary and continence columns to symptom_reports
-- Also update fn_check_alerts() with new alert rules

-- 1. Add columns
ALTER TABLE symptom_reports
  ADD COLUMN IF NOT EXISTS urinary TEXT DEFAULT '正常',
  ADD COLUMN IF NOT EXISTS continence TEXT DEFAULT '正常';

-- 2. Replace fn_check_alerts() with expanded version (10 rules)
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
    v_urinary_streak INT := 0;
    v_urinary_broke BOOLEAN := FALSE;
    v_continence_streak INT := 0;
    v_continence_broke BOOLEAN := FALSE;
    v_cnt INT;
    -- For ascending pain
    v_prev_pain INT := -1;
    v_ascending INT := 0;
    v_ascending_broke BOOLEAN := FALSE;
BEGIN
    -- Walk last 7 reports (most recent first) for consecutive streaks
    FOR rec IN
        SELECT pain_nrs, bleeding, bowel, fever, urinary, continence
        FROM symptom_reports
        WHERE study_id = NEW.study_id
        ORDER BY report_date DESC
        LIMIT 7
    LOOP
        -- Pain ≥ 8 consecutive
        IF NOT v_pain_broke THEN
            IF rec.pain_nrs >= 8 THEN v_pain_streak := v_pain_streak + 1;
            ELSE v_pain_broke := TRUE; END IF;
        END IF;

        -- Ascending pain (track from most recent backwards)
        IF NOT v_ascending_broke THEN
            IF v_prev_pain = -1 THEN
                v_prev_pain := rec.pain_nrs;
                v_ascending := 1;
            ELSIF rec.pain_nrs < v_prev_pain THEN
                -- Going back in time: older record has LOWER pain = ascending trend
                v_ascending := v_ascending + 1;
                v_prev_pain := rec.pain_nrs;
            ELSE
                v_ascending_broke := TRUE;
            END IF;
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

        -- Urinary difficulty consecutive
        IF NOT v_urinary_broke THEN
            IF rec.urinary IN ('困難', '尿不出來') THEN v_urinary_streak := v_urinary_streak + 1;
            ELSE v_urinary_broke := TRUE; END IF;
        END IF;

        -- Continence issue consecutive
        IF NOT v_continence_broke THEN
            IF rec.continence IN ('滲便', '失禁') THEN v_continence_streak := v_continence_streak + 1;
            ELSE v_continence_broke := TRUE; END IF;
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

    -- Rule 2: Ascending pain 3+ consecutive days
    IF v_ascending >= 3 THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'ascending_pain' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'ascending_pain', 'warning',
                '近 3 天疼痛持續上升，一般術後疼痛應逐日遞減，建議聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 3: Persistent bleeding 2+ consecutive
    IF v_bleed_streak >= 2 THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'persistent_bleeding' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'persistent_bleeding', 'danger',
                '已連續 ' || v_bleed_streak || ' 次回報持續性出血，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 4: Blood clot (single instance)
    IF NEW.bleeding = '血塊' THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'blood_clot' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'blood_clot', 'danger',
                '您回報了出血伴隨血塊，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 5: No bowel 3+ consecutive days
    IF v_bowel_streak >= 3 THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'no_bowel' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'no_bowel', 'warning',
                '已連續 ' || v_bowel_streak || ' 天未排便，建議聯絡醫療機構評估是否需要處置。');
        END IF;
    END IF;

    -- Rule 6: Fever
    IF NEW.fever = TRUE THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'fever' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'fever', 'danger',
                '您回報了發燒症狀，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 7: Urinary retention (完全尿不出來) — immediate
    IF NEW.urinary = '尿不出來' THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'urinary_retention' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'urinary_retention', 'danger',
                '您回報了完全尿不出來，這是術後需要立即處理的狀況，建議儘速聯絡醫療機構。');
        END IF;
    END IF;

    -- Rule 8: Urinary difficulty 2+ consecutive days
    IF v_urinary_streak >= 2 AND NEW.urinary = '困難' THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'urinary_difficulty' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'urinary_difficulty', 'warning',
                '已連續 ' || v_urinary_streak || ' 天排尿困難，建議聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 9: Incontinence (失禁) — immediate
    IF NEW.continence = '失禁' THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'incontinence' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'incontinence', 'danger',
                '您回報了無法控制排便，建議儘速聯絡醫療機構評估。');
        END IF;
    END IF;

    -- Rule 10: Soiling (滲便) 2+ consecutive days
    IF v_continence_streak >= 2 AND NEW.continence = '滲便' THEN
        SELECT COUNT(*) INTO v_cnt FROM alerts
            WHERE study_id = NEW.study_id AND alert_type = 'soiling' AND acknowledged = FALSE;
        IF v_cnt = 0 THEN
            INSERT INTO alerts (study_id, alert_type, alert_level, message)
            VALUES (NEW.study_id, 'soiling', 'warning',
                '已連續 ' || v_continence_streak || ' 天出現滲便，建議聯絡醫療機構評估。');
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger (function already replaced above)
DROP TRIGGER IF EXISTS trg_check_alerts ON symptom_reports;
CREATE TRIGGER trg_check_alerts
    AFTER INSERT ON symptom_reports
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_alerts();
