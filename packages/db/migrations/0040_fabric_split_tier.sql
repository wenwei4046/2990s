-- ============================================================================
-- 0040_fabric_split_tier.sql
--
-- Add per-context (sofa vs bedframe) price tiers to fabric_trackings.
-- Mirrors HOOKKA migration 0069_fabric_split_price_tier: one fabric can be
-- P2 in sofa context but P1 in bedframe context. Sofa column also covers
-- accessories. The legacy `price_tier` column is kept; the resolver falls
-- back to it when the split columns are NULL.
--
-- Also adds PRICE_3 to the fabric_price_tier enum.
-- ============================================================================

BEGIN;

-- Postgres doesn't allow adding an enum value inside a transaction in older
-- versions, but Supabase runs PG 15+ which supports it as of PG 12.
ALTER TYPE fabric_price_tier ADD VALUE IF NOT EXISTS 'PRICE_3';

-- Split columns. Type is the existing fabric_price_tier enum so it auto-picks
-- up PRICE_3 from the ALTER above.
ALTER TABLE fabric_trackings
  ADD COLUMN IF NOT EXISTS sofa_price_tier     fabric_price_tier,
  ADD COLUMN IF NOT EXISTS bedframe_price_tier fabric_price_tier;

-- Backfill from legacy column so existing rows resolve identically until the
-- operator splits them in the UI.
UPDATE fabric_trackings SET sofa_price_tier     = price_tier WHERE sofa_price_tier     IS NULL AND price_tier IS NOT NULL;
UPDATE fabric_trackings SET bedframe_price_tier = price_tier WHERE bedframe_price_tier IS NULL AND price_tier IS NOT NULL;

COMMIT;
