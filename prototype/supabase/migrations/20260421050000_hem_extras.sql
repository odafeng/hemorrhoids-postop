-- Extend surgical_records with Hemorrhoidectomy-specific fields:
--  - energy_device TEXT[] (e.g. {'ligasure'}, {'ligasure','harmonic'}, empty)
--  - suture_material TEXT  (only meaningful for closed/semi_open/semi_closed)
-- No DB-level CHECK — form gates show/hide.

ALTER TABLE surgical_records
  ADD COLUMN IF NOT EXISTS energy_device  TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS suture_material TEXT;
