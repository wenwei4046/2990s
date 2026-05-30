-- 0109_mfg_sell_price.sql
-- Phase 1 · Cost/Sell split (COST-SELL-SPLIT-PLAN.md, decisions D2/D3).
--
-- mfg_products.base_price_sen / price1_sen / seat_height_prices are the COST
-- (read by computeMfgLineCost; computeMfgLinePrice's selling base is hard 0).
-- Until now the POS ALSO read base_price_sen as the customer-facing SELLING
-- price (Catalog / useProduct / useProductSizes) — a dual-duty conflict.
--
-- This adds a dedicated SELLING column and backfills it = current base_price_sen
-- so NO displayed price changes on apply. The POS customer reads are repointed
-- to sell_price_sen (?? base_price_sen) in the same change set. base_price_sen
-- then unambiguously means COST.
--
-- Additive + non-destructive. Apply once (team convention — not tracked by the
-- drizzle _journal; run via psql / db-migrate.yml). The backfill is scoped by
-- `WHERE sell_price_sen IS NULL` so a re-run is a no-op.
ALTER TABLE mfg_products ADD COLUMN sell_price_sen integer;

UPDATE mfg_products SET sell_price_sen = base_price_sen WHERE sell_price_sen IS NULL;
