-- 0166_mfg_products_barcode.sql
-- SKU barcode (owner request 2026-06-12). Free-text barcode per mfg_products
-- row — surfaced as a default-hidden SKU Master column, editable from the SKU
-- drawers, and matched by the SKU Master server-side search.

ALTER TABLE mfg_products ADD COLUMN IF NOT EXISTS barcode TEXT;
