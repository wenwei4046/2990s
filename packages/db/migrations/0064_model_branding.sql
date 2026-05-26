-- ----------------------------------------------------------------------------
-- 0064 — product_models.branding + listing reset (PR #65).
--
-- Commander 2026-05-26: showed up to the Models list and noticed the names
-- looked wrong — Sofa Models showed "SOFA 5530 1A" (the first SKU's
-- compartment got dragged into the Model name) and Bedframe Models still
-- had "(6FT)" suffix. He wants:
--
--   1. Branding made a required Model field — "Hilton", "Houzs", "Sealy", ...
--      drives both the SKU name template and the printed catalogue.
--   2. Listings cleared so he can start from scratch.
--   3. A defined code-generation template he can rely on (see comments
--      below; full spec also lives in apps/api/src/routes/product-models.ts).
--
-- Code-generation template (enforced server-side in generate-skus):
--
--   SOFA      code: {model_code}-{compartment}        e.g. 5530-1A(LHF)
--             name: {branding} SOFA {compartment}     e.g. HOUZS SOFA 1A(LHF)
--
--   BEDFRAME  code: {model_code}-({size_code})        e.g. 1003-(K)
--             name: {branding} BEDFRAME ({size_label}) e.g. HILTON BEDFRAME (6FT)
--
--   MATTRESS  code: {model_code}-({size_code})        e.g. PURE-(K)
--             name: {branding} ({size_label})          e.g. SEALY (6FT)
--
-- The cleanup DELETEs in step 2 were already executed against production via
-- Chrome MCP before this migration file was written — keeping them here so
-- a fresh `pnpm db:reset` repro from migration history lands on the same
-- empty state.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Add branding column.
ALTER TABLE product_models
  ADD COLUMN IF NOT EXISTS branding TEXT;

-- 2. Reset Sofa / Bedframe / Mattress listings — commander starts fresh.
--    Idempotent: a second run finds nothing to delete and is a no-op.
DELETE FROM mfg_products    WHERE category IN ('SOFA','BEDFRAME','MATTRESS');
DELETE FROM product_models  WHERE category IN ('SOFA','BEDFRAME','MATTRESS');

COMMIT;
