-- 0113_mfg_included_addons.sql
-- Phase 3 · Cost/Sell split (decision D7). Permanent free-gift display.
--
-- Per-SKU "included add-ons" on the SELLING side — e.g. a mattress ships with
-- 2 free pillows. Same {addonId, qty} jsonb shape as the legacy
-- products.included_addons. The Master Account sets it; the POS Configurator
-- renders "× N INCLUDED" (that render already exists — this just feeds it for
-- mfg products). DISPLAY-ONLY: does NOT deduct inventory or cost.
-- Additive; IF NOT EXISTS guards a re-run.
ALTER TABLE mfg_products ADD COLUMN IF NOT EXISTS included_addons jsonb NOT NULL DEFAULT '[]'::jsonb;
