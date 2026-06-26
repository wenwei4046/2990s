-- ----------------------------------------------------------------------------
-- 0186 — four extra master columns on suppliers so an AutoCount creditor
-- export can be seeded 1:1 (Houzs-led parity, ported from Houzs 0028).
--   registration_no    — company registration number (AutoCount "Reg. No.")
--   nature_of_business — free-text business nature line
--   exemption_no       — SST / tax exemption number
--   phone2             — secondary phone (E.164, normalized by the API)
--
-- DISTINCT from the existing business_reg_no / business_nature columns: those
-- predate this work and are kept as separate concepts. These four mirror the
-- AutoCount creditor-export field names exactly.
--
-- All columns nullable, additive, idempotent — safe to re-run.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_no text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS nature_of_business text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS exemption_no text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone2 text;

COMMIT;
