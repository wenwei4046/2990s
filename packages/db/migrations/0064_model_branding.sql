-- ----------------------------------------------------------------------------
-- 0064 — product_models.branding column (PR #65).
--
-- Commander 2026-05-26: showed up to the Models list and noticed the names
-- looked wrong — Sofa Models showed "SOFA 5530 1A" (the first SKU's
-- compartment got dragged into the Model name) and Bedframe Models still
-- had "(6FT)" suffix. He wants Branding made a required Model field —
-- "Hilton", "Houzs", "Sealy", ... drives both the SKU name template and
-- the printed catalogue.
--
-- Code-generation template (enforced server-side in generate-skus):
--   SOFA      code: {model_code}-{compartment}        e.g. 5530-1A(LHF)
--             name: {branding} SOFA {compartment}     e.g. HOUZS SOFA 1A(LHF)
--   BEDFRAME  code: {model_code}-({size_code})        e.g. 1003-(K)
--             name: {branding} BEDFRAME ({size_label}) e.g. HILTON BEDFRAME (6FT)
--   MATTRESS  code: {model_code}-({size_code})        e.g. PURE-(K)
--             name: {branding} ({size_label})          e.g. SEALY (6FT)
--
-- ⚠️ DEFANGED PR #112 — Commander 2026-05-26: "为什么会不见". The original
-- file used to also carry these two lines:
--
--   DELETE FROM mfg_products    WHERE category IN ('SOFA','BEDFRAME','MATTRESS');
--   DELETE FROM product_models  WHERE category IN ('SOFA','BEDFRAME','MATTRESS');
--
-- That was a one-shot wipe so commander could re-seed. The data was already
-- nuked manually via Chrome MCP before this file ever existed, so we left
-- the DELETEs here for "fresh repro from migration history".
--
-- Reality: today the migration replayed (GH Actions / Supabase editor /
-- drizzle push — root cause TBD), and the DELETEs wiped 141 SOFA/BEDFRAME/
-- MATTRESS SKUs + the original Models from production. SKUs were
-- regenerated from the surviving Model templates via the existing
-- generate-skus endpoint (PR #112 patch session), but prices set BEFORE
-- the wipe are gone — no audit trail of values.
--
-- Removed the DELETE statements so this migration is now ALTER-only and
-- safe to replay any number of times. If you ever genuinely want to wipe
-- those categories, do it as a one-off SQL paste with an inline
-- confirmation, NOT as a checked-in migration.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Add branding column (already applied; ALTER is idempotent).
ALTER TABLE product_models
  ADD COLUMN IF NOT EXISTS branding TEXT;

-- 2. (DELETEs intentionally removed — see header comment.)

COMMIT;
