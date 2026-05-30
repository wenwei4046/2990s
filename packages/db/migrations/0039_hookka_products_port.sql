-- ============================================================================
-- 0039_hookka_products_port.sql
--
-- Port HOOKKA Products + Maintenance module into the 2990s schema.
-- See packages/db/src/schema.ts §"Manufacturing modules" for the Drizzle
-- definitions that this migration matches.
--
-- 7 new tables + 5 new enums. Money columns use INTEGER `_sen` (HOOKKA
-- convention) to preserve precision on surcharge math; measurements use
-- `_centi` / `_milli` scaling to avoid floats.
--
-- Companion seed: packages/db/seeds/hookka-products-import.sql
-- (Maintenance config baseline is in this migration; product/fabric data
-- lives in the companion seed.)
-- ============================================================================

BEGIN;

-- ── Enums ────────────────────────────────────────────────────────────────
CREATE TYPE mfg_product_category AS ENUM ('SOFA','BEDFRAME','ACCESSORY');
CREATE TYPE mfg_product_status   AS ENUM ('ACTIVE','INACTIVE');
CREATE TYPE fabric_category      AS ENUM ('B.M-FABR','S-FABR','S.M-FABR','LINING','WEBBING');
CREATE TYPE fabric_price_tier    AS ENUM ('PRICE_1','PRICE_2');
CREATE TYPE maintenance_config_scope AS ENUM ('master','customer');

-- ── mfg_products ─────────────────────────────────────────────────────────
CREATE TABLE mfg_products (
  id                       TEXT PRIMARY KEY,
  code                     TEXT NOT NULL,
  name                     TEXT NOT NULL,
  category                 mfg_product_category NOT NULL,
  description              TEXT,
  base_model               TEXT,
  size_code                TEXT,
  size_label               TEXT,
  fabric_usage_centi       INTEGER NOT NULL DEFAULT 0,
  unit_m3_milli            INTEGER NOT NULL DEFAULT 0,
  status                   mfg_product_status NOT NULL DEFAULT 'ACTIVE',
  cost_price_sen           INTEGER NOT NULL DEFAULT 0,
  base_price_sen           INTEGER,
  price1_sen               INTEGER,
  production_time_minutes  INTEGER NOT NULL DEFAULT 0,
  sub_assemblies           JSONB,
  sku_code                 TEXT,
  fabric_color             TEXT,
  pieces                   JSONB,
  seat_height_prices       JSONB,
  default_variants         JSONB,
  retail_product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mfg_products_code       ON mfg_products(code);
CREATE INDEX idx_mfg_products_category   ON mfg_products(category);
CREATE INDEX idx_mfg_products_base_model ON mfg_products(base_model);

-- ── product_dept_configs ─────────────────────────────────────────────────
CREATE TABLE product_dept_configs (
  product_code              TEXT PRIMARY KEY,
  unit_m3_milli             INTEGER NOT NULL DEFAULT 0,
  fabric_usage_centi        INTEGER NOT NULL DEFAULT 0,
  price2_sen                INTEGER NOT NULL DEFAULT 0,
  fab_cut_category          TEXT,
  fab_cut_minutes           INTEGER,
  fab_sew_category          TEXT,
  fab_sew_minutes           INTEGER,
  wood_cut_category         TEXT,
  wood_cut_minutes          INTEGER,
  foam_category             TEXT,
  foam_minutes              INTEGER,
  framing_category          TEXT,
  framing_minutes           INTEGER,
  upholstery_category       TEXT,
  upholstery_minutes        INTEGER,
  packing_category          TEXT,
  packing_minutes           INTEGER,
  sub_assemblies            JSONB,
  heights_sub_assemblies    JSONB
);

-- ── fabrics ──────────────────────────────────────────────────────────────
CREATE TABLE fabrics (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  category            TEXT,
  price_sen           INTEGER NOT NULL DEFAULT 0,
  soh_meters_centi    INTEGER NOT NULL DEFAULT 0,
  reorder_level_centi INTEGER NOT NULL DEFAULT 0
);

-- ── fabric_trackings ─────────────────────────────────────────────────────
CREATE TABLE fabric_trackings (
  id                       TEXT PRIMARY KEY,
  fabric_code              TEXT NOT NULL,
  fabric_description       TEXT,
  fabric_category          fabric_category,
  price_tier               fabric_price_tier,
  price_centi              INTEGER NOT NULL DEFAULT 0,
  soh_centi                INTEGER NOT NULL DEFAULT 0,
  po_outstanding_centi     INTEGER NOT NULL DEFAULT 0,
  last_month_usage_centi   INTEGER NOT NULL DEFAULT 0,
  one_week_usage_centi     INTEGER NOT NULL DEFAULT 0,
  two_weeks_usage_centi    INTEGER NOT NULL DEFAULT 0,
  one_month_usage_centi    INTEGER NOT NULL DEFAULT 0,
  shortage_centi           INTEGER NOT NULL DEFAULT 0,
  reorder_point_centi      INTEGER NOT NULL DEFAULT 0,
  supplier                 TEXT,
  lead_time_days           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_fabric_trackings_code ON fabric_trackings(fabric_code);
CREATE INDEX idx_fabric_trackings_tier ON fabric_trackings(price_tier);

-- ── maintenance_config_history ──────────────────────────────────────────
-- The big JSON blob with effective dating. scope is 'master' or
-- 'customer:<uuid>'. Append-only — edits are new rows.
CREATE TABLE maintenance_config_history (
  id              TEXT PRIMARY KEY,
  scope           TEXT NOT NULL,
  config          JSONB NOT NULL,
  effective_from  DATE NOT NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX idx_mch_scope_eff
  ON maintenance_config_history(scope, effective_from DESC, created_at DESC);

-- ── master_price_history ────────────────────────────────────────────────
CREATE TABLE master_price_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code  TEXT NOT NULL,
  field         TEXT NOT NULL,
  old_value_sen INTEGER,
  new_value_sen INTEGER,
  reason        TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by    UUID REFERENCES staff(id) ON DELETE SET NULL
);

CREATE INDEX idx_mph_code ON master_price_history(product_code);

-- ── Maintenance config baseline (master scope, effective 2020-01-01) ────
-- Sourced verbatim from HOOKKA's DEFAULT_MAINTENANCE_CONFIG
-- (src/pages/products/index.tsx lines 715-780). 60+ items across 8 sub-tabs.
INSERT INTO maintenance_config_history (id, scope, config, effective_from, notes)
VALUES (
  'mch-baseline-master-001',
  'master',
  $$
  {
    "divanHeights": [
      {"value":"4\"","priceSen":0},
      {"value":"5\"","priceSen":0},
      {"value":"6\"","priceSen":0},
      {"value":"8\"","priceSen":0},
      {"value":"10\"","priceSen":5000},
      {"value":"11\"","priceSen":12000},
      {"value":"12\"","priceSen":12000},
      {"value":"13\"","priceSen":14000},
      {"value":"14\"","priceSen":14000},
      {"value":"16\"","priceSen":15000}
    ],
    "legHeights": [
      {"value":"No Leg","priceSen":0},
      {"value":"1\"","priceSen":0},
      {"value":"2\"","priceSen":0},
      {"value":"4\"","priceSen":0},
      {"value":"6\"","priceSen":0},
      {"value":"7\"","priceSen":16000}
    ],
    "totalHeights": [
      {"value":"10\"","priceSen":0},
      {"value":"12\"","priceSen":0},
      {"value":"14\"","priceSen":0},
      {"value":"16\"","priceSen":5000},
      {"value":"18\"","priceSen":5000},
      {"value":"20\"","priceSen":10000},
      {"value":"22\"","priceSen":12000},
      {"value":"24\"","priceSen":14000},
      {"value":"26\"","priceSen":15000},
      {"value":"28\"","priceSen":16000}
    ],
    "gaps": ["4\"","5\"","6\"","7\"","8\"","9\"","10\""],
    "specials": [
      {"value":"HB Fully Cover","priceSen":5000},
      {"value":"Divan Top Fully Cover","priceSen":5000},
      {"value":"Divan Full Cover","priceSen":8000},
      {"value":"Left Drawer","priceSen":15000},
      {"value":"Right Drawer","priceSen":15000},
      {"value":"Front Drawer","priceSen":12000},
      {"value":"HB Straight","priceSen":0},
      {"value":"Divan Top(W)","priceSen":0},
      {"value":"1 Piece Divan","priceSen":25000},
      {"value":"Divan Curve","priceSen":5000},
      {"value":"No Side Panel","priceSen":4000},
      {"value":"Headboard Only","priceSen":0},
      {"value":"Nylon Fabric","priceSen":0},
      {"value":"5537 Backrest","priceSen":0},
      {"value":"Add 1\" Infront L","priceSen":0},
      {"value":"Separate Backrest Packing","priceSen":0},
      {"value":"Divan A11","priceSen":0},
      {"value":"Seat Add On 4\"","priceSen":0}
    ],
    "sofaLegHeights": [
      {"value":"No Leg","priceSen":0},
      {"value":"4\"","priceSen":0},
      {"value":"6\"","priceSen":0}
    ],
    "sofaSpecials": [
      {"value":"Nylon Fabric","priceSen":0},
      {"value":"5537 Backrest","priceSen":0},
      {"value":"Separate Backrest Packing","priceSen":0}
    ],
    "sofaSizes": ["24","26","28","30","32","35"]
  }
  $$::jsonb,
  '2020-01-01'::date,
  'Baseline ported from HOOKKA DEFAULT_MAINTENANCE_CONFIG (2026-05-24)'
);

COMMIT;
