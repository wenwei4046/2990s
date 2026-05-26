-- ----------------------------------------------------------------------------
-- 0062 — Product Models layer (PR #49).
--
-- Commander 2026-05-26: "每一个 SKU 都是要独立行的，可是它还有这种第二层次，
-- 就是类似 Group by 的概念，进行统一管理。要不然 seat size 那么多不是全部
-- sofa 都有的。就是开 code 不需要开 20 次".
--
-- Per-SKU rows on mfg_products stay independent (each variant has its own
-- code, stock, cost, pricing). Models are the second-layer TEMPLATE that
-- owns the allowed-options pool + name template + photo. PR #50 follows up
-- with a "Generate SKU variants" button that uses allowed_options to bulk-
-- INSERT all the children — that's how the commander avoids opening a code
-- 20 times for every Sofa/Bedframe Model.
--
-- This migration ONLY creates the foundation:
--   1. `product_models` table — the second-layer template entity.
--   2. Backfill from distinct `base_model` values already on mfg_products.
--   3. `mfg_products.model_id UUID` FK + backfill.
--   4. `base_model` text stays as a denormalized convenience column.
--
-- allowed_options JSONB shape is category-specific:
--   BEDFRAME: { sizes: ['K','Q','S','SS'], divan_heights: [...], total_heights: [...],
--               gaps: [...], leg_heights: [...], specials: [...] }
--   SOFA:     { compartments: ['1A-LHF','1A-RHF','1NA','2A-LHF'...],
--               sizes: ['24','28','30'] (seat sizes), leg_heights: [...], specials: [...] }
--   MATTRESS: { sizes: ['K','Q','S','SS'] }
-- Empty `{}` = no restriction yet (UI falls back to global maintenance_config pool).
-- ----------------------------------------------------------------------------

BEGIN;

-- ──────────────────────────── product_models ────────────────────────────
CREATE TABLE IF NOT EXISTS product_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_code      TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        mfg_product_category NOT NULL,
  description     TEXT,
  photo_url       TEXT,
  allowed_options JSONB NOT NULL DEFAULT '{}'::jsonb,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_models_code_category_unique UNIQUE (model_code, category)
);

CREATE INDEX IF NOT EXISTS idx_product_models_category
  ON product_models (category);

-- ────────────────────────── Backfill from mfg_products ──────────────────────
INSERT INTO product_models (model_code, name, category, description)
SELECT
  mp.base_model AS model_code,
  COALESCE(
    NULLIF(TRIM(regexp_replace(
      (SELECT name FROM mfg_products mp2
        WHERE mp2.base_model = mp.base_model AND mp2.category = mp.category
        ORDER BY mp2.code LIMIT 1),
      '\s*\([^)]*\)\s*$', ''
    )), ''),
    (SELECT name FROM mfg_products mp2
      WHERE mp2.base_model = mp.base_model AND mp2.category = mp.category
      ORDER BY mp2.code LIMIT 1)
  ) AS name,
  mp.category,
  NULL AS description
FROM mfg_products mp
WHERE mp.base_model IS NOT NULL AND mp.base_model <> ''
GROUP BY mp.base_model, mp.category
ON CONFLICT (model_code, category) DO NOTHING;

-- ────────────────────────── mfg_products.model_id FK ────────────────────────
ALTER TABLE mfg_products
  ADD COLUMN IF NOT EXISTS model_id UUID
    REFERENCES product_models(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mfg_products_model_id
  ON mfg_products (model_id);

UPDATE mfg_products mp
SET model_id = pm.id
FROM product_models pm
WHERE mp.base_model = pm.model_code
  AND mp.category = pm.category
  AND mp.model_id IS NULL;

-- ────────────────────────── updated_at trigger ─────────────────────────────
CREATE OR REPLACE FUNCTION product_models_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_models_updated_at ON product_models;
CREATE TRIGGER trg_product_models_updated_at
  BEFORE UPDATE ON product_models
  FOR EACH ROW EXECUTE FUNCTION product_models_set_updated_at();

COMMIT;
