-- ----------------------------------------------------------------------------
-- 0086 — Supplier category canonical values + supplier-scoped maintenance.
--
-- Commander 2026-05-27: "supplier 那边不能选择我们现有 SKU category 就是说
-- 这个 supplier 是负责什么的 然后直接把整个 product maintenance 塞过去.
-- 然后我们就可以根据类别来开价". When a PO is created against a supplier,
-- the surcharge pricing (divan / leg / specials) should resolve to that
-- supplier's own maintenance config first, falling back to the master
-- config when the supplier has none yet.
--
-- Storage shape:
--   suppliers.category — text (already exists since PR #40), now constrained
--                        to the canonical category set so the Pricing tab
--                        can branch reliably on it.
--   maintenance_config_history.scope — text (already exists), now also
--                        accepts 'supplier:<uuid>' rows alongside 'master'
--                        and 'customer:<uuid>'. No DDL needed.
--
-- Canonical categories (Commander spec 2026-05-27):
--   SOFA / BEDFRAME / MATTRESS / ACCESSORY / SERVICE / MIXED
--
-- Normalisation pass first uppercases existing free-text values and folds
-- common synonyms ('Bedframe' → BEDFRAME, 'Fabric' → MIXED since it doesn't
-- map to a maintenance section, 'Hardware' → ACCESSORY). Anything that
-- still doesn't match the canonical set gets nulled out so commander can
-- pick the right value from the dropdown.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Normalise existing supplier.category values to the canonical set.
--
--    The PR #40 import seeded free-text strings ('Bedframe', 'Fabric',
--    'Hardware', ...). Map them into the canonical enum-like set.
UPDATE suppliers
SET category = CASE
  WHEN category IS NULL OR btrim(category) = '' THEN NULL
  WHEN upper(btrim(category)) IN ('SOFA') THEN 'SOFA'
  WHEN upper(btrim(category)) IN ('BEDFRAME', 'BED FRAME', 'BED') THEN 'BEDFRAME'
  WHEN upper(btrim(category)) IN ('MATTRESS') THEN 'MATTRESS'
  WHEN upper(btrim(category)) IN ('ACCESSORY', 'ACCESSORIES', 'HARDWARE') THEN 'ACCESSORY'
  WHEN upper(btrim(category)) IN ('SERVICE') THEN 'SERVICE'
  -- Anything multi-category (fabric supplier serving both sofa + bedframe,
  -- mixed retailer, etc.) becomes MIXED — surfaces every maintenance tab.
  WHEN upper(btrim(category)) IN ('FABRIC', 'MIXED', 'GENERAL') THEN 'MIXED'
  ELSE NULL  -- commander reassigns from the dropdown
END;

-- 2. Add CHECK constraint so future writes stay canonical.
ALTER TABLE suppliers
  DROP CONSTRAINT IF EXISTS suppliers_category_check;
ALTER TABLE suppliers
  ADD CONSTRAINT suppliers_category_check
  CHECK (category IS NULL OR category IN ('SOFA','BEDFRAME','MATTRESS','ACCESSORY','SERVICE','MIXED'));

-- 3. Index supplier_id-scoped maintenance lookups.
--
--    The resolver fetches `WHERE scope = 'supplier:<uuid>' ORDER BY
--    effective_from DESC LIMIT 1` — the existing idx_mch_scope_eff covers
--    this since scope is the leading column and we're matching by exact
--    string equality. No new index needed.
--
--    No CHECK on maintenance_config_history.scope on purpose — the format
--    is enforced at the application layer (parseScope) so future scopes
--    (e.g. 'showroom:<id>') don't require a migration.

COMMIT;
