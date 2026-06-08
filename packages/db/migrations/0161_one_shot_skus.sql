-- 0161_one_shot_skus.sql
-- Loo 2026-06-08 — auto-mint one-shot SKUs from a product-page remark + extra
-- charge. Two new mfg_products columns mark + trace the minted rows; one new
-- so_settings flag gates the whole behaviour (default OFF: ship code dark, flip
-- ON after live verification). Spec docs/specs/2026-06-08-remark-extra-auto-sku-spec.md.

BEGIN;

ALTER TABLE mfg_products ADD COLUMN IF NOT EXISTS one_shot      boolean NOT NULL DEFAULT false;
ALTER TABLE mfg_products ADD COLUMN IF NOT EXISTS source_doc_no text;

INSERT INTO so_settings (key, enabled, label)
VALUES ('pos_remark_extra_auto_sku', false, 'Auto-mint SKU from remark + extra charge')
ON CONFLICT (key) DO NOTHING;

COMMIT;
