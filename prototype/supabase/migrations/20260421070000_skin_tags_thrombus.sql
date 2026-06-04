-- Add skin_tags + thrombus findings to surgical_records.
-- Applies to both procedure types (hemorrhoidectomy + laser hemorrhoidoplasty).
-- Form UI gates these as yes/no; false default matches a negative finding.

ALTER TABLE surgical_records
  ADD COLUMN IF NOT EXISTS skin_tags BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS thrombus  BOOLEAN NOT NULL DEFAULT FALSE;
