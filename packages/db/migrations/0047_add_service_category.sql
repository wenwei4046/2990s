-- ----------------------------------------------------------------------------
-- 0047 — Add SERVICE to mfg_product_category enum.
--
-- Commander asked for a fifth category alongside SOFA / BEDFRAME / ACCESSORY /
-- MATTRESS, used for labour / installation / delivery surcharge SKUs that
-- appear on B2B sales orders but aren't physical goods.
--
-- ALTER TYPE ... ADD VALUE cannot run inside an explicit transaction block,
-- so this migration is intentionally NOT wrapped in BEGIN/COMMIT. Apply via
-- Supabase SQL Editor: paste, Run.
-- ----------------------------------------------------------------------------

ALTER TYPE mfg_product_category ADD VALUE IF NOT EXISTS 'SERVICE';
