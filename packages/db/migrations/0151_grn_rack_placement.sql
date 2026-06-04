-- 0151 — Goods-receipt → rack placement link.
--
-- Lets a GRN line carry the physical rack it was received into, and links each
-- rack item back to the GRN that placed it so a GRN cancel can pull it again.
--
-- The rack module (warehouse_racks / warehouse_rack_items, migration 0094) is a
-- SEPARATE physical-placement ledger from the FIFO inventory ledger. These two
-- nullable FKs bridge them only at goods-receipt time:
--   - grn_items.rack_id          — which rack this received line goes onto (chosen on the GRN form)
--   - warehouse_rack_items.source_grn_id — which GRN placed this rack item (for exact reversal on cancel)
-- Both nullable: From-PO / manual GRN lines and manual rack stock-ins keep working with no rack/GRN link.

BEGIN;

ALTER TABLE grn_items
  ADD COLUMN IF NOT EXISTS rack_id UUID REFERENCES warehouse_racks(id) ON DELETE SET NULL;

COMMENT ON COLUMN grn_items.rack_id IS
  'Optional physical rack (warehouse_racks) this received line is placed onto at goods-receipt. NULL = not placed on any rack.';

ALTER TABLE warehouse_rack_items
  ADD COLUMN IF NOT EXISTS source_grn_id UUID REFERENCES grns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_rack_items_source_grn
  ON warehouse_rack_items(source_grn_id) WHERE source_grn_id IS NOT NULL;

COMMENT ON COLUMN warehouse_rack_items.source_grn_id IS
  'The GRN that auto-placed this rack item at goods-receipt. NULL for manual stock-ins. Used to reverse rack placement on GRN cancel.';

COMMIT;
