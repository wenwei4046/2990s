-- 0076 — Per-line-item photos for SO (PR-F).
-- Commander 2026-05-27: customisation orders need photos attached per line
-- (color swatches, sketches, customer-supplied refs). Store as an array of
-- R2 object keys. The bucket binding lives in wrangler.toml as
-- SO_ITEM_PHOTOS (commander provisions the bucket separately).

BEGIN;

ALTER TABLE mfg_sales_order_items
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';

COMMIT;
