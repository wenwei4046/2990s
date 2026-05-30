-- ----------------------------------------------------------------------------
-- 0084 — City-level warehouse override on my_localities.
--
-- Commander 2026-05-27: "warehouse 就是 state 这边 assign 然后 cities 和
-- postcode 全部会自动跟着妈妈 (state) 的 warehouse. 然后我要换我就双击点
-- 进去 manually 换那个 cities 是要 under 什么 warehouse 可是全部 postcode
-- 都是跟着一起换 因为上级已经混改了".
--
-- Model: warehouse_id on my_localities is the OVERRIDE. NULL means follow
-- the state-level mapping (state_warehouse_mappings.warehouse_id). When
-- commander overrides at the city level, ALL postcodes under that city
-- get the same warehouse_id stamp (handled client-side as a bulk PATCH).
--
-- The lookup chain on the SO Detail "Sales Location" auto-suggest:
--   1. my_localities.warehouse_id for the picked (postcode/city/state)
--   2. state_warehouse_mappings.warehouse_id for the state
--   3. NULL (coordinator picks manually)
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE my_localities
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_my_localities_warehouse_id
  ON my_localities(warehouse_id);

COMMIT;
