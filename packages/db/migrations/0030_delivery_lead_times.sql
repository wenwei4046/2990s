-- 0030_delivery_lead_times.sql
-- Per-category minimum delivery lead times.
-- Rules locked 2026-05-22 with Loo:
--   * Cart contains mattress or bed frame → delivery_date must be
--     >= placed_at + mattress_bedframe_lead_days (default 20).
--   * Cart contains sofa → delivery_date must be
--     >= placed_at + sofa_lead_days (default 30).
--   * Mixed cart → the larger of the applicable lead times wins.
--   * Both rates editable in Backend Settings → Delivery (same form as fees).

ALTER TABLE delivery_fee_config
  ADD COLUMN IF NOT EXISTS mattress_bedframe_lead_days integer NOT NULL DEFAULT 20
    CHECK (mattress_bedframe_lead_days >= 0),
  ADD COLUMN IF NOT EXISTS sofa_lead_days integer NOT NULL DEFAULT 30
    CHECK (sofa_lead_days >= 0);

COMMENT ON COLUMN delivery_fee_config.mattress_bedframe_lead_days IS
  'Minimum days between order placement and delivery when cart contains mattress or bed frame.';
COMMENT ON COLUMN delivery_fee_config.sofa_lead_days IS
  'Minimum days between order placement and delivery when cart contains sofa.';

-- ─── Refine the pricing_version trigger ───────────────────────────────────
-- The existing trigger bumps pricing_version on ANY UPDATE to this table.
-- Lead-time edits don't affect pricing — so editing them should not invalidate
-- in-flight quotes. Re-create the trigger scoped to the fee columns only.
DROP TRIGGER IF EXISTS bump_pricing_version_delivery_fee_config ON delivery_fee_config;
CREATE TRIGGER bump_pricing_version_delivery_fee_config
  AFTER UPDATE OF base_fee, cross_category_fee ON delivery_fee_config
  FOR EACH STATEMENT EXECUTE FUNCTION bump_pricing_version();
