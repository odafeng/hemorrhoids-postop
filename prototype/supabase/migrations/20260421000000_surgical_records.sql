-- Surgical records + surgeon-scoped researcher RLS
-- Created 2026-04-21. Corresponds to the MCP-applied migration
-- `surgical_records_and_surgeon_filter`.

-- =====================================================
-- 1. Helpers
-- =====================================================

-- Read surgeon_id from JWT metadata (mirrors get_user_role / get_user_study_id)
CREATE OR REPLACE FUNCTION get_user_surgeon_id()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.jwt() -> 'user_metadata' ->> 'surgeon_id';
$$;

-- Reusable updated_at trigger fn
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- =====================================================
-- 2. surgical_records table
-- =====================================================

CREATE TABLE IF NOT EXISTS surgical_records (
  id                SERIAL PRIMARY KEY,
  study_id          VARCHAR(20) NOT NULL UNIQUE
                    REFERENCES patients(study_id) ON DELETE CASCADE,
  procedure_type    VARCHAR(30) NOT NULL
                    CHECK (procedure_type IN ('hemorrhoidectomy','laser_hemorrhoidoplasty')),
  hemorrhoidectomy_subtype VARCHAR(20)
                    CHECK (hemorrhoidectomy_subtype IS NULL
                      OR hemorrhoidectomy_subtype IN ('open','closed','semi_open','semi_closed')),
  hemorrhoid_grade  VARCHAR(4) CHECK (hemorrhoid_grade IN ('I','II','III','IV')),
  clock_positions   INTEGER[]  NOT NULL DEFAULT '{}',
  laser_joules      JSONB,     -- {"3": 250, "7": 260, "11": 240}
  blood_loss_ml     INTEGER    CHECK (blood_loss_ml >= 0),
  duration_min      INTEGER    CHECK (duration_min  >= 0),
  patient_position  VARCHAR(30)
                    CHECK (patient_position IN ('lithotomy','prone_jackknife','left_lateral','other')),
  self_paid_items   TEXT[] NOT NULL DEFAULT '{}',
  notes             TEXT,
  recorded_by       UUID REFERENCES auth.users(id),
  surgeon_id        VARCHAR(20) NOT NULL,   -- denormalised for RLS speed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subtype_only_when_hem CHECK (
    procedure_type = 'hemorrhoidectomy'
    OR (procedure_type = 'laser_hemorrhoidoplasty' AND hemorrhoidectomy_subtype IS NULL)
  ),
  CONSTRAINT joules_only_when_laser CHECK (
    procedure_type = 'laser_hemorrhoidoplasty'
    OR (procedure_type = 'hemorrhoidectomy' AND laser_joules IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_surgical_records_surgeon ON surgical_records(surgeon_id);

ALTER TABLE surgical_records ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_surgical_records_updated ON surgical_records;
CREATE TRIGGER trg_surgical_records_updated BEFORE UPDATE ON surgical_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================
-- 3. RLS on surgical_records
-- =====================================================

DROP POLICY IF EXISTS "patient_read_own_surgical" ON surgical_records;
CREATE POLICY "patient_read_own_surgical" ON surgical_records FOR SELECT
  USING (get_user_role()='patient' AND (study_id)::text = get_user_study_id());

DROP POLICY IF EXISTS "researcher_read_own_surgeon" ON surgical_records;
CREATE POLICY "researcher_read_own_surgeon" ON surgical_records FOR SELECT
  USING (get_user_role()='researcher' AND (surgeon_id)::text = get_user_surgeon_id());

DROP POLICY IF EXISTS "researcher_insert_own_surgeon" ON surgical_records;
CREATE POLICY "researcher_insert_own_surgeon" ON surgical_records FOR INSERT
  WITH CHECK (
    get_user_role()='researcher'
    AND (surgeon_id)::text = get_user_surgeon_id()
    AND EXISTS (SELECT 1 FROM patients p
                WHERE (p.study_id)::text = (surgical_records.study_id)::text
                  AND (p.surgeon_id)::text = get_user_surgeon_id())
  );

DROP POLICY IF EXISTS "researcher_update_own_surgeon" ON surgical_records;
CREATE POLICY "researcher_update_own_surgeon" ON surgical_records FOR UPDATE
  USING  (get_user_role()='researcher' AND (surgeon_id)::text = get_user_surgeon_id())
  WITH CHECK (get_user_role()='researcher' AND (surgeon_id)::text = get_user_surgeon_id());

DROP POLICY IF EXISTS "pi_manage_surgical" ON surgical_records;
CREATE POLICY "pi_manage_surgical" ON surgical_records FOR ALL
  USING (get_user_role()='pi') WITH CHECK (get_user_role()='pi');

-- =====================================================
-- 4. Tighten researcher read policies on existing tables
--    to scope by surgeon_id. PI policies untouched.
--
-- Transition safety: researcher accounts created before this migration
-- have no surgeon_id in their metadata at all.  For those accounts
-- get_user_surgeon_id() returns NULL, and a straight equality check
-- (surgeon_id = NULL) is always FALSE in SQL — locking them out
-- immediately after deploy.
--
-- To avoid that regression, every researcher SELECT policy also allows
-- access when get_user_surgeon_id() IS NULL (old "read-all" fallback).
-- Once a PI assigns surgeon_id via researcher-invite / researcher-manage
-- and the researcher's JWT is refreshed, the scoped check takes over
-- automatically.  After all researchers have been assigned a surgeon
-- this NULL branch can be removed in a follow-up migration.
-- =====================================================

DROP POLICY IF EXISTS "researcher_read_all_patients" ON patients;
DROP POLICY IF EXISTS "researcher_read_own_surgeon_patients" ON patients;
CREATE POLICY "researcher_read_own_surgeon_patients" ON patients FOR SELECT
  USING (
    get_user_role()='researcher'
    AND (
      get_user_surgeon_id() IS NULL                       -- unassigned: backward-compat
      OR (surgeon_id)::text = get_user_surgeon_id()       -- assigned: scoped access
    )
  );

DROP POLICY IF EXISTS "researcher_read_reports" ON symptom_reports;
CREATE POLICY "researcher_read_reports" ON symptom_reports FOR SELECT USING (
  get_user_role()='researcher'
  AND (
    get_user_surgeon_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM patients p WHERE (p.study_id)::text = (symptom_reports.study_id)::text
        AND (p.surgeon_id)::text = get_user_surgeon_id()
    )
  )
);

DROP POLICY IF EXISTS "researcher_read_chat" ON ai_chat_logs;
CREATE POLICY "researcher_read_chat" ON ai_chat_logs FOR SELECT USING (
  get_user_role()='researcher'
  AND (
    get_user_surgeon_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM patients p WHERE (p.study_id)::text = (ai_chat_logs.study_id)::text
        AND (p.surgeon_id)::text = get_user_surgeon_id()
    )
  )
);

DROP POLICY IF EXISTS "researcher_review_chat" ON ai_chat_logs;
CREATE POLICY "researcher_review_chat" ON ai_chat_logs FOR UPDATE USING (
  get_user_role()='researcher'
  AND (
    get_user_surgeon_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM patients p WHERE (p.study_id)::text = (ai_chat_logs.study_id)::text
        AND (p.surgeon_id)::text = get_user_surgeon_id()
    )
  )
);

DROP POLICY IF EXISTS "researcher_read_alerts" ON alerts;
CREATE POLICY "researcher_read_alerts" ON alerts FOR SELECT USING (
  get_user_role()='researcher'
  AND (
    get_user_surgeon_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM patients p WHERE (p.study_id)::text = (alerts.study_id)::text
        AND (p.surgeon_id)::text = get_user_surgeon_id()
    )
  )
);

DROP POLICY IF EXISTS "researcher_read_surveys" ON usability_surveys;
CREATE POLICY "researcher_read_surveys" ON usability_surveys FOR SELECT USING (
  get_user_role()='researcher'
  AND (
    get_user_surgeon_id() IS NULL
    OR EXISTS (
      SELECT 1 FROM patients p WHERE (p.study_id)::text = (usability_surveys.study_id)::text
        AND (p.surgeon_id)::text = get_user_surgeon_id()
    )
  )
);
