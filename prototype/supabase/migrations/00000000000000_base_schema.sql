-- ============================================================
-- 痔瘡術後 AI 衛教系統 — Supabase Database Schema
-- Split-table: PII (加密) ↔ Research Data (去識別化)
-- With Row Level Security (RLS)
-- ============================================================
--
-- ⚠️  REFERENCE ONLY — NOT THE SOURCE OF TRUTH
--
-- The authoritative schema is defined by the ordered migrations in:
--   supabase/migrations/
--
-- This file is a historical snapshot and may be OUTDATED.
-- For example, symptom_reports is missing urinary/continence columns
-- that were added in 20260324_urinary_continence.sql.
--
-- To get the current live schema, run:
--   supabase db dump --schema public > db/schema_snapshot.sql
--
-- ============================================================
--
-- Supabase Auth 角色設計：
--   auth.users.raw_user_meta_data->'role':
--     'patient'    → 病人：可提交自己的症狀回報、使用 AI 衛教
--     'researcher' → 研究團隊：可讀取所有去識別化研究資料
--     'pi'         → 主持人：可存取個資主檔（需稽核紀錄）
--
--   auth.users.raw_user_meta_data->'study_id':
--     病人帳號綁定的研究編號，用於 RLS 限定只能存取自己的資料
-- ============================================================

-- 0. 啟用加密擴充
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================
-- HELPER: 角色判斷函數
-- =========================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT COALESCE(
    auth.jwt() -> 'user_metadata' ->> 'role',
    'anon'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_study_id()
RETURNS TEXT AS $$
  SELECT auth.jwt() -> 'user_metadata' ->> 'study_id';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- =========================================================
-- ZONE A: 個資主檔 (PII) — 加密儲存，僅 PI 可存取
-- =========================================================

CREATE TABLE pii_patients (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) UNIQUE NOT NULL,

    -- ▼ 加密欄位 (pgp_sym_encrypt, AES-256) ▼
    name_enc        BYTEA NOT NULL,
    birth_date_enc  BYTEA NOT NULL,
    mrn_enc         BYTEA NOT NULL,
    phone_enc       BYTEA,
    national_id_enc BYTEA,

    -- 知情同意
    consent_signed  BOOLEAN NOT NULL DEFAULT FALSE,
    consent_date    DATE,
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enrolled_by     VARCHAR(100),

    -- 退出
    withdrawn       BOOLEAN NOT NULL DEFAULT FALSE,
    withdrawn_at    TIMESTAMPTZ,
    withdrawn_reason TEXT
);

ALTER TABLE pii_patients ENABLE ROW LEVEL SECURITY;

-- PI 可完整存取個資
CREATE POLICY "pi_full_access_pii" ON pii_patients
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- 個資存取稽核紀錄
CREATE TABLE pii_access_log (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) NOT NULL,
    accessed_by     VARCHAR(100) NOT NULL,
    access_type     VARCHAR(20) NOT NULL,
    access_reason   TEXT,
    accessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address      INET
);

ALTER TABLE pii_access_log ENABLE ROW LEVEL SECURITY;

-- PI 可讀寫稽核紀錄
CREATE POLICY "pi_manage_access_log" ON pii_access_log
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- =========================================================
-- ZONE B: 研究資料 (去識別化) — 研究團隊可存取，病人限自己
-- =========================================================

-- B1. 病人研究資料 (去識別化)
CREATE TABLE patients (
    study_id        VARCHAR(20) PRIMARY KEY,
    age             INTEGER,
    sex             VARCHAR(10),
    bmi             DECIMAL(5,2),
    surgery_type    VARCHAR(50),
    surgery_date    DATE NOT NULL,
    hemorrhoid_grade VARCHAR(10),
    surgeon_id      VARCHAR(20),
    anesthesia_type VARCHAR(30),

    app_activated   BOOLEAN NOT NULL DEFAULT FALSE,
    app_activated_at TIMESTAMPTZ,
    study_status    VARCHAR(20) NOT NULL DEFAULT 'active',
    completed_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

-- 病人只能看自己
CREATE POLICY "patient_read_own" ON patients
  FOR SELECT
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

-- 研究團隊＋PI 可讀取全部
CREATE POLICY "researcher_read_all_patients" ON patients
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));

-- PI 可寫入（收案時建立）
CREATE POLICY "pi_manage_patients" ON patients
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- B2. 每日症狀回報
CREATE TABLE symptom_reports (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    report_date     DATE NOT NULL,
    pod             INTEGER NOT NULL,

    pain_nrs        INTEGER CHECK (pain_nrs BETWEEN 0 AND 10),
    bleeding        VARCHAR(10),
    bowel           VARCHAR(10),
    fever           BOOLEAN,
    wound           VARCHAR(20),

    reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    report_source   VARCHAR(20) DEFAULT 'app',

    UNIQUE(study_id, report_date)
);

ALTER TABLE symptom_reports ENABLE ROW LEVEL SECURITY;

-- 病人可新增、讀取、更新自己的回報
CREATE POLICY "patient_insert_own_report" ON symptom_reports
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

CREATE POLICY "patient_read_own_reports" ON symptom_reports
  FOR SELECT
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

CREATE POLICY "patient_update_own_report" ON symptom_reports
  FOR UPDATE
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  )
  WITH CHECK (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

-- 研究團隊＋PI 可讀取全部
CREATE POLICY "researcher_read_reports" ON symptom_reports
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));

-- PI 可完整管理
CREATE POLICY "pi_manage_reports" ON symptom_reports
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- B3. 規則引擎警示
CREATE TABLE alerts (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    alert_type      VARCHAR(30) NOT NULL,
    alert_level     VARCHAR(10) NOT NULL,
    message         TEXT,
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;

-- 病人讀取自己的警示
CREATE POLICY "patient_read_own_alerts" ON alerts
  FOR SELECT
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

-- 研究團隊＋PI 讀取全部
CREATE POLICY "researcher_read_alerts" ON alerts
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));

-- 系統（service_role）或 PI 可寫入
CREATE POLICY "pi_manage_alerts" ON alerts
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- B4. AI 衛教互動紀錄
CREATE TABLE ai_chat_logs (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    user_message    TEXT NOT NULL,
    ai_response     TEXT NOT NULL,
    matched_topic   VARCHAR(50),

    reviewed        BOOLEAN DEFAULT FALSE,
    reviewed_by     VARCHAR(100),
    reviewed_at     TIMESTAMPTZ,
    review_result   VARCHAR(20),
    review_notes    TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_chat_logs ENABLE ROW LEVEL SECURITY;

-- 病人可新增、讀取自己的聊天
CREATE POLICY "patient_insert_own_chat" ON ai_chat_logs
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

CREATE POLICY "patient_read_own_chat" ON ai_chat_logs
  FOR SELECT
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

-- 研究團隊＋PI 可讀取全部（品質審核用）
CREATE POLICY "researcher_read_chat" ON ai_chat_logs
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));

-- PI 可更新審核狀態
CREATE POLICY "pi_manage_chat" ON ai_chat_logs
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- 研究人員可更新審核欄位
CREATE POLICY "researcher_review_chat" ON ai_chat_logs
  FOR UPDATE
  USING (get_user_role() = 'researcher')
  WITH CHECK (get_user_role() = 'researcher');

-- B5. 醫療利用紀錄
CREATE TABLE healthcare_utilization (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    event_type      VARCHAR(30) NOT NULL,
    event_date      DATE NOT NULL,
    pod_at_event    INTEGER,
    reason          TEXT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE healthcare_utilization ENABLE ROW LEVEL SECURITY;

-- 研究團隊＋PI 可讀取
CREATE POLICY "researcher_read_utilization" ON healthcare_utilization
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));

-- PI 可完整管理
CREATE POLICY "pi_manage_utilization" ON healthcare_utilization
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- B6. 可用性問卷
CREATE TABLE usability_surveys (
    id              SERIAL PRIMARY KEY,
    study_id        VARCHAR(20) NOT NULL REFERENCES patients(study_id),
    survey_date     DATE NOT NULL,
    pod_at_survey   INTEGER,

    ease_of_use     INTEGER CHECK (ease_of_use BETWEEN 1 AND 5),
    usefulness      INTEGER CHECK (usefulness BETWEEN 1 AND 5),
    satisfaction    INTEGER CHECK (satisfaction BETWEEN 1 AND 5),
    recommend       INTEGER CHECK (recommend BETWEEN 1 AND 5),
    overall_score   INTEGER CHECK (overall_score BETWEEN 1 AND 5),
    feedback_text   TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE usability_surveys ENABLE ROW LEVEL SECURITY;

-- 病人可填寫自己的問卷
CREATE POLICY "patient_insert_own_survey" ON usability_surveys
  FOR INSERT
  WITH CHECK (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

CREATE POLICY "patient_read_own_survey" ON usability_surveys
  FOR SELECT
  USING (
    get_user_role() = 'patient'
    AND study_id = get_user_study_id()
  );

-- 研究團隊＋PI 可讀取全部
CREATE POLICY "researcher_read_surveys" ON usability_surveys
  FOR SELECT
  USING (get_user_role() IN ('researcher', 'pi'));

CREATE POLICY "pi_manage_surveys" ON usability_surveys
  FOR ALL
  USING (get_user_role() = 'pi')
  WITH CHECK (get_user_role() = 'pi');

-- =========================
-- INDEXES
-- =========================
CREATE INDEX idx_reports_study_id ON symptom_reports(study_id);
CREATE INDEX idx_reports_date ON symptom_reports(report_date);
CREATE INDEX idx_reports_study_date ON symptom_reports(study_id, report_date);
CREATE INDEX idx_alerts_study_id ON alerts(study_id);
CREATE INDEX idx_chat_study_id ON ai_chat_logs(study_id);
CREATE INDEX idx_chat_unreviewed ON ai_chat_logs(reviewed) WHERE reviewed = FALSE;
CREATE INDEX idx_utilization_study ON healthcare_utilization(study_id);
CREATE INDEX idx_pii_log_study ON pii_access_log(study_id);

-- =========================
-- VIEWS (分析用，去識別化)
-- =========================

CREATE VIEW v_symptom_timeline AS
SELECT
    sr.study_id,
    p.age, p.sex, p.surgery_type, p.hemorrhoid_grade,
    sr.report_date, sr.pod,
    sr.pain_nrs, sr.bleeding, sr.bowel, sr.fever, sr.wound
FROM symptom_reports sr
JOIN patients p ON sr.study_id = p.study_id
WHERE p.study_status != 'withdrawn'
ORDER BY sr.study_id, sr.pod;

CREATE VIEW v_adherence_summary AS
SELECT
    p.study_id,
    p.age, p.sex, p.surgery_type, p.surgery_date,
    COUNT(sr.id) AS total_reports,
    MAX(sr.pod) AS max_pod,
    ROUND(COUNT(sr.id)::NUMERIC / GREATEST(MAX(sr.pod) + 1, 1) * 100, 1) AS adherence_pct,
    MIN(sr.pain_nrs) AS min_pain,
    MAX(sr.pain_nrs) AS max_pain,
    ROUND(AVG(sr.pain_nrs), 1) AS avg_pain,
    BOOL_OR(a.id IS NOT NULL) AS had_alerts
FROM patients p
LEFT JOIN symptom_reports sr ON p.study_id = sr.study_id
LEFT JOIN alerts a ON p.study_id = a.study_id
WHERE p.study_status != 'withdrawn'
GROUP BY p.study_id, p.age, p.sex, p.surgery_type, p.surgery_date;
