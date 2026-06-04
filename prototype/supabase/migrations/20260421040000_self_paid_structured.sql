-- Replace surgical_records.self_paid_items (TEXT[]) with a structured
-- JSONB column. Expected shape:
-- {
--   "hemostatic_gauze": ["quikclot","military","other"],
--   "hemostatic_gauze_other": "自訂品名",
--   "wound_gel": ["liquidband","glitch","other"],
--   "wound_gel_other": "自訂品名",
--   "prp": true,
--   "prp_brand": "Regen Lab",
--   "healiaid": true,
--   "newepi": false,
--   "other": "任意備註"
-- }
-- No existing rows to migrate (surgical_records is empty as of 2026-04-21).

ALTER TABLE surgical_records DROP COLUMN IF EXISTS self_paid_items;
ALTER TABLE surgical_records ADD COLUMN IF NOT EXISTS self_paid JSONB NOT NULL DEFAULT '{}'::jsonb;
