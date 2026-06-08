-- ----------------------------------------------------------------------------
-- 0160 — per-add-on SERVICE SKU (Loo 2026-06-07).
--
-- Order add-ons created in the POS editor all booked under the ONE generic
-- SVC-ADDON SKU (0157), so per-add-on reporting/aggregation was impossible.
-- This adds addons.service_sku: when set, computeAddonServiceLines books the
-- add-on under that code; when NULL it falls back to the legacy hardcoded
-- ADDON_ID_TO_SERVICE_SKU map, then to the generic SVC-ADDON — so existing
-- rows keep their exact behavior at apply time and pre-deploy code ignores
-- the column entirely (additive, deploy-order safe).
--
-- The 3 classic add-ons are backfilled with the dedicated codes the hardcoded
-- map already gave them (data becomes the truth; the map stays as fallback).
-- The matching mfg_products SERVICE rows for custom codes are minted by the
-- editor at save time via POST /mfg-products (mirrors the 0157 SVC-ADDON
-- seed shape), keeping the Edge #4 "SERVICE SKU must exist" gate satisfied.
--
-- No RLS change: the existing addons policies (SELECT all staff, write
-- admin) already cover the new column.
-- ----------------------------------------------------------------------------

ALTER TABLE addons ADD COLUMN IF NOT EXISTS service_sku text;

-- DB-level format guard: SVC- prefix, uppercase alphanumerics + dashes.
-- (The same regex the editor enforces; belt-and-suspenders for direct writes.)
ALTER TABLE addons DROP CONSTRAINT IF EXISTS addons_service_sku_format;
ALTER TABLE addons ADD CONSTRAINT addons_service_sku_format
  CHECK (service_sku IS NULL OR service_sku ~ '^SVC-[A-Z0-9-]+$');

UPDATE addons SET service_sku = 'SVC-DISPOSE-MATTRESS' WHERE id = 'dispose-mattress';
UPDATE addons SET service_sku = 'SVC-DISPOSE-BEDFRAME' WHERE id = 'dispose-bedframe';
UPDATE addons SET service_sku = 'SVC-LIFT-CARRY'       WHERE id = 'lift';
