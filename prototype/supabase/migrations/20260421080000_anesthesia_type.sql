-- Add anesthesia type to surgical records.
-- Single-select. Nullable so existing rows remain valid.
-- IVGA = IV general anesthesia
-- LMGA = Laryngeal mask general anesthesia
-- SA   = Spinal anesthesia
-- LA   = Local anesthesia
ALTER TABLE public.surgical_records
  ADD COLUMN IF NOT EXISTS anesthesia_type TEXT
    CHECK (anesthesia_type IS NULL OR anesthesia_type IN ('IVGA', 'LMGA', 'SA', 'LA'));

COMMENT ON COLUMN public.surgical_records.anesthesia_type
  IS 'Anesthesia used for the procedure. NULL for legacy rows recorded before this column was added.';
