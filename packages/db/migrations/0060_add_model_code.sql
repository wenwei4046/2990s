-- ----------------------------------------------------------------------------
-- 0060 — Add model_code column to products.
--
-- Sofa Models now carry a friendly "real name" in products.name (e.g. "Pllao",
-- "Lotti", "Ommbuc") per Loo's 2026-05-26 decision. The technical model code
-- (e.g. "SF 5130", "AM 9036") moves to its own column so the Sales Order can
-- show "<model_code> · <name>" while the catalogue / cart / configurator show
-- only the friendly name.
--
-- Free text, nullable: only sofas set it. Mattress / bedframe / addon lines
-- stay NULL, so the Sales Order shows just the name for those. No enum and no
-- backfill, so the migration is backward-compatible with already-deployed code
-- (selecting the column before the new POS build ships simply returns NULL).
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS model_code TEXT;

COMMIT;
