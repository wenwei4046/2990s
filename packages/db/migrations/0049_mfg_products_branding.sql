-- ----------------------------------------------------------------------------
-- 0049 — Add branding text column to mfg_products.
--
-- Commander asked for mattress SKUs to carry a "Branding" label (e.g.
-- "Sealy", "King Koil", "Dunlopillo") in place of the redundant Category
-- column when the user is already filtering by Mattress.
--
-- Field is free text — no enum so suppliers can add new brands without a
-- migration. Stays nullable so the migration doesn't break existing rows.
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE mfg_products
  ADD COLUMN IF NOT EXISTS branding TEXT;

COMMIT;
