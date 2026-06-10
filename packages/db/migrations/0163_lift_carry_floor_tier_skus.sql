-- ----------------------------------------------------------------------------
-- 0163 — per-floor lift-carry tier SKUs (Loo 2026-06-10, option B)
--
-- One SKU per floor 1..5 so a Backend-keyed SO prices itself: pick the floor
-- SKU, qty = pieces carried, sell price auto-fills. Pricing mirrors the POS
-- rule max(floors−2, 0) × RM100/item — floors 1–2 are FREE but still get a
-- SKU so the free band shows on the SO as an RM0 line (Loo: "even though
-- they are free, still need to show in SO").
--
-- The legacy SVC-LIFT-CARRY row stays: history references it, and the POS
-- builder falls back to it for floors above 5 (computeAddonServiceLines,
-- packages/shared/src/service-lines.ts). Names must stay in lockstep with
-- svcLiftCarryTierName in packages/shared/src/service-sku.ts.
--
-- Same seed shape as 0155 §3 (idempotent by code; pos_active=false keeps
-- them out of the POS catalog grid).
-- ----------------------------------------------------------------------------

INSERT INTO mfg_products (id, code, name, category, status, cost_price_sen, sell_price_sen, pos_active)
SELECT v.id, v.code, v.name, 'SERVICE'::mfg_product_category, 'ACTIVE'::mfg_product_status, 0, v.sell_price_sen, false
FROM (VALUES
  ('mfg-svc-lift-carry-f1', 'SVC-LIFT-CARRY-F1', 'Lift access / stair carry — 1st floor',     0),
  ('mfg-svc-lift-carry-f2', 'SVC-LIFT-CARRY-F2', 'Lift access / stair carry — 2nd floor',     0),
  ('mfg-svc-lift-carry-f3', 'SVC-LIFT-CARRY-F3', 'Lift access / stair carry — 3rd floor', 10000),
  ('mfg-svc-lift-carry-f4', 'SVC-LIFT-CARRY-F4', 'Lift access / stair carry — 4th floor', 20000),
  ('mfg-svc-lift-carry-f5', 'SVC-LIFT-CARRY-F5', 'Lift access / stair carry — 5th floor', 30000)
) AS v(id, code, name, sell_price_sen)
WHERE NOT EXISTS (SELECT 1 FROM mfg_products p WHERE p.code = v.code);
