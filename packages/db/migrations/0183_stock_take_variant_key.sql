-- ----------------------------------------------------------------------------
-- 0183 — Stock take: count + adjust PER (product_code, variant_key).
--
-- BUG-2026-06-20-008 #15 (HIGH, data corruption): the count snapshot was the
-- SKU TOTAL across all variants (v_inventory_all_skus, which SUMs variant_key),
-- but the posted ADJUSTMENT carried NO variant_key, so it defaulted to the ''
-- bucket. For any attributed SKU (sofa / bedframe / mattress) this corrupted
-- per-variant on-hand + valuation: the real variant bucket kept its qty while a
-- phantom adjustment landed in '' (where FIFO finds no lots → no COGS write-off).
--
-- Fix: the count sheet is now built per (product_code, variant_key) from
-- inventory_balances (variant-grained), and the post stamps variant_key on the
-- ADJUSTMENT so it lands in the bucket it measured. (The route also re-reads
-- LIVE on-hand at post so the result is exactly the counted qty — this also
-- supersedes the stale-snapshot reconcile on branch fix/stock-take-reconcile.)
--
-- Additive + idempotent — safe to apply before the code deploys (existing rows
-- get variant_key='' and behave exactly as before until the new code runs).
-- ----------------------------------------------------------------------------

ALTER TABLE stock_take_lines ADD COLUMN IF NOT EXISTS variant_key   TEXT NOT NULL DEFAULT '';
ALTER TABLE stock_take_lines ADD COLUMN IF NOT EXISTS variant_label TEXT;

-- The old uniqueness was "one line per SKU per take"; it is now "one line per
-- (SKU, variant) per take", or two variants of the same SKU collide on insert.
DROP INDEX IF EXISTS stock_take_lines_take_product_unique;
CREATE UNIQUE INDEX IF NOT EXISTS stock_take_lines_take_product_variant_unique
  ON stock_take_lines (stock_take_id, product_code, variant_key);
