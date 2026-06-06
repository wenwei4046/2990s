-- ----------------------------------------------------------------------------
-- 0157 — handover add-on membership becomes data-driven (Loo 2026-06-06).
--
-- Which order add-ons appear on the POS handover "Add-ons & payment" screen
-- was a hardcoded ID allowlist in the frontend (HANDOVER_ADDON_IDS) plus a
-- hardcoded addon→SVC-SKU map on the server — so an admin-created add-on
-- could NEVER reach handover without a code change, even though the editor
-- promised it would. Two pieces:
--
--   1. addons.show_at_handover — the membership flag the POS now filters on.
--      Seeded true for the three live handover add-ons (matches the old
--      hardcoded list exactly → zero behavior change at apply time; the
--      pre-deploy frontend ignores the column entirely).
--
--   2. SVC-ADDON — ONE generic SERVICE SKU for any FUTURE handover add-on.
--      The three live ones keep their dedicated SVC-* SKUs from 0155; an
--      add-on without a dedicated mapping books a SERVICE line under
--      SVC-ADDON with the add-on's label as the line description (the SO/DO/
--      SI documents read fine, and Edge #4's "SERVICE SKU must exist" gate
--      stays satisfied with no per-addon SKU minting).
--
-- No RLS change: the existing addons policies (SELECT all staff, write
-- admin) already cover the new column.
-- ----------------------------------------------------------------------------

ALTER TABLE addons ADD COLUMN IF NOT EXISTS show_at_handover boolean NOT NULL DEFAULT false;

UPDATE addons SET show_at_handover = true
WHERE id IN ('dispose-mattress', 'dispose-bedframe', 'lift');

-- Generic execution SERVICE SKU (mirrors the 0155 seed shape; idempotent by code).
INSERT INTO mfg_products (id, code, name, category, status, cost_price_sen, sell_price_sen, pos_active)
SELECT 'mfg-svc-addon', 'SVC-ADDON', 'Order add-on service', 'SERVICE'::mfg_product_category, 'ACTIVE'::mfg_product_status, 0, 0, false
WHERE NOT EXISTS (SELECT 1 FROM mfg_products p WHERE p.code = 'SVC-ADDON');
