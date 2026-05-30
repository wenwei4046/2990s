-- ----------------------------------------------------------------------------
-- 0089 — supplier_material_bindings.price_matrix
--
-- Commander 2026-05-27 ("我的意思是，你怎么没有跟着 Product Maintenance 的排版？
-- 因为你看我的 Product Maintenance 的沙发，它是有不一样 Seat Size 的价钱的，
-- 然后 bedframe 它有 Price 1 跟 Price 2 的"):
--
-- Today supplier_material_bindings stores ONE unit price per (supplier × SKU).
-- That works for accessories / services / mattresses (single-price per SKU),
-- but commander wants per-category supplier COSTS that mirror the Products
-- Maintenance shape:
--   · SOFA — distinct cost per seat-height × fabric tier (24/26/28/30/32/35
--             × P1/P2/P3, same matrix Products renders under the Sofa tab)
--   · BEDFRAME — Price 1 + Price 2 (fabric upholstery tiers)
--   · MATTRESS / ACCESSORY / SERVICE — single unit_price_centi (unchanged)
--
-- New JSONB column `price_matrix` holds the category-shaped object. Shape is
-- validated at the API layer (apps/api/src/routes/suppliers.ts) per the
-- binding's mfg_products.category. NULL = "no per-category cost set yet";
-- callers fall back to unit_price_centi (or 0).
--
-- We keep unit_price_centi intact — it remains the source of truth for the
-- single-price categories AND is the implicit "default cost" if a category
-- has a matrix shape but no cell value set yet. The UI's inline-edit hooks
-- both columns: matrix cells PATCH price_matrix; the legacy column PATCHes
-- unit_price_centi for accessory / service / mattress rows.
--
-- Migration is additive + idempotent. No data backfill: existing rows
-- start with price_matrix = NULL and the UI falls back to unit_price_centi.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE supplier_material_bindings
  ADD COLUMN IF NOT EXISTS price_matrix JSONB NULL;

COMMENT ON COLUMN supplier_material_bindings.price_matrix IS
  'Category-shaped supplier cost matrix (PR — Commander 2026-05-27). '
  'SOFA: {"24":{"P1":N,"P2":N,"P3":N},"26":{...},...} keyed by seat-height inches then fabric tier. '
  'BEDFRAME: {"P1":N,"P2":N} — fabric upholstery tier prices. '
  'MATTRESS/ACCESSORY/SERVICE: NULL — use unit_price_centi instead. '
  'Values are integer centi (× 100 from RM). NULL keys/cells mean "no price set yet" — '
  'fall back to unit_price_centi or 0.';

COMMIT;
