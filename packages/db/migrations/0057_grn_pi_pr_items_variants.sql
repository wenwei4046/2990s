-- ----------------------------------------------------------------------------
-- 0057 — Variant columns on grn_items / purchase_invoice_items /
--        purchase_return_items (PR #42).
--
-- Commander 2026-05-26 全部都套用. Mirrors mfg_sales_order_items (PR #35)
-- and purchase_order_items (PR #41, migration 0056) so PO→GRN→PI / GRN→PR
-- conversions preserve sofa color / bedframe D1 / leg / special.
-- ----------------------------------------------------------------------------

BEGIN;

-- ── grn_items ───────────────────────────────────────────────────────────
ALTER TABLE grn_items
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
  ADD COLUMN IF NOT EXISTS discount_centi          INTEGER NOT NULL DEFAULT 0;

-- ── purchase_invoice_items ──────────────────────────────────────────────
ALTER TABLE purchase_invoice_items
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
  ADD COLUMN IF NOT EXISTS discount_centi          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_cost_centi         INTEGER NOT NULL DEFAULT 0;

-- ── purchase_return_items ──────────────────────────────────────────────
ALTER TABLE purchase_return_items
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
  ADD COLUMN IF NOT EXISTS uom                     TEXT NOT NULL DEFAULT 'UNIT';

COMMIT;
