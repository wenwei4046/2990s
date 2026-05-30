-- ----------------------------------------------------------------------------
-- 0045 — Add MATTRESS to mfg_product_category enum.
--
-- Commander asked for a fourth category alongside SOFA / BEDFRAME / ACCESSORY.
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction block,
-- so this migration is intentionally NOT wrapped in BEGIN/COMMIT.
-- Apply via Supabase SQL Editor: paste, Run.
-- ----------------------------------------------------------------------------

ALTER TYPE mfg_product_category ADD VALUE IF NOT EXISTS 'MATTRESS';
