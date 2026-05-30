-- Sofa combo cost/sell split (Phase 5, Part 1). The existing prices_by_height
-- becomes the COST benchmark; selling_prices_by_height is the SELLING price the
-- app charges, set by Master Admin. Backfilled = prices_by_height so nothing
-- changes on day one (mirrors module migration 0109's sell = cost backfill).
ALTER TABLE sofa_combo_pricing
  ADD COLUMN IF NOT EXISTS selling_prices_by_height jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE sofa_combo_pricing
  SET selling_prices_by_height = prices_by_height
  WHERE selling_prices_by_height = '{}'::jsonb;

COMMENT ON COLUMN sofa_combo_pricing.prices_by_height IS
  'COST benchmark, per-height centi. Cost/PO side (Backend).';
COMMENT ON COLUMN sofa_combo_pricing.selling_prices_by_height IS
  'SELLING price, per-height centi, set by Master Admin. What the app charges.';
