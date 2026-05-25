-- ----------------------------------------------------------------------------
-- 0058 — Variant columns on delivery_order_items / sales_invoice_items /
--        consignment_order_items / consignment_note_items (PR #43).
--
-- Commander 2026-05-26 全部都套用. Final step to mirror mfg_sales_order_items
-- shape across all 8 doc modules. Now SO→DO→SI conversions and Consignment
-- in/out/return preserve sofa color / bedframe D1 / leg / special.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── delivery_order_items ───────────────────────────────────────────────
ALTER TABLE delivery_order_items
  ADD COLUMN IF NOT EXISTS gap_inches              INTEGER,
  ADD COLUMN IF NOT EXISTS divan_height_inches     INTEGER,
  ADD COLUMN IF NOT EXISTS divan_price_sen         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leg_height_inches       INTEGER,
  ADD COLUMN IF NOT EXISTS leg_price_sen           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_specials         JSONB,
  ADD COLUMN IF NOT EXISTS line_suffix             TEXT,
  ADD COLUMN IF NOT EXISTS special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variants                JSONB,
  ADD COLUMN IF NOT EXISTS item_group              TEXT,
  ADD COLUMN IF NOT EXISTS description             TEXT,
  ADD COLUMN IF NOT EXISTS description2            TEXT,
  ADD COLUMN IF NOT EXISTS uom                     TEXT NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS unit_price_centi        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_centi          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_total_centi        INTEGER NOT NULL DEFAULT 0;

-- ── sales_invoice_items ───────────────────────────────────────────────
ALTER TABLE sales_invoice_items
  ADD COLUMN IF NOT EXISTS gap_inches              INTEGER,
  ADD COLUMN IF NOT EXISTS divan_height_inches     INTEGER,
  ADD COLUMN IF NOT EXISTS divan_price_sen         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leg_height_inches       INTEGER,
  ADD COLUMN IF NOT EXISTS leg_price_sen           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_specials         JSONB,
  ADD COLUMN IF NOT EXISTS line_suffix             TEXT,
  ADD COLUMN IF NOT EXISTS special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variants                JSONB,
  ADD COLUMN IF NOT EXISTS item_group              TEXT,
  ADD COLUMN IF NOT EXISTS description2            TEXT,
  ADD COLUMN IF NOT EXISTS uom                     TEXT NOT NULL DEFAULT 'UNIT';

-- ── consignment_order_items + consignment_note_items ──────────────────
ALTER TABLE consignment_order_items
  ADD COLUMN IF NOT EXISTS gap_inches              INTEGER,
  ADD COLUMN IF NOT EXISTS divan_height_inches     INTEGER,
  ADD COLUMN IF NOT EXISTS divan_price_sen         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leg_height_inches       INTEGER,
  ADD COLUMN IF NOT EXISTS leg_price_sen           INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS custom_specials         JSONB,
  ADD COLUMN IF NOT EXISTS line_suffix             TEXT,
  ADD COLUMN IF NOT EXISTS special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variants                JSONB,
  ADD COLUMN IF NOT EXISTS item_group              TEXT,
  ADD COLUMN IF NOT EXISTS uom                     TEXT NOT NULL DEFAULT 'UNIT';

ALTER TABLE consignment_note_items
  ADD COLUMN IF NOT EXISTS variants                JSONB,
  ADD COLUMN IF NOT EXISTS item_group              TEXT,
  ADD COLUMN IF NOT EXISTS uom                     TEXT NOT NULL DEFAULT 'UNIT';

COMMIT;
