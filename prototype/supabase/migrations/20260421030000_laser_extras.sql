-- Extend surgical_records with 3 laser-specific fields
-- (Laser hemorrhoidoplasty-only; no DB-level CHECK — UI gates them)

ALTER TABLE surgical_records
  ADD COLUMN IF NOT EXISTS combined_partial_hemorrhoidectomy          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS combined_partial_hemorrhoidectomy_positions INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pedicle_ligation                           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pedicle_ligation_positions                 INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS mucosal_injury                             BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mucosal_injury_repaired                    BOOLEAN,
  ADD COLUMN IF NOT EXISTS mucosal_injury_positions                   INTEGER[] NOT NULL DEFAULT '{}';
