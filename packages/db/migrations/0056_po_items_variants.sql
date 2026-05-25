-- ----------------------------------------------------------------------------
-- 0056 — Add variant columns to purchase_order_items (PR #41)
--
-- Commander 2026-05-26: "我的 PO 需要可以很 raw，就像 Sales Order 那样".
-- For SO→DO→SI / PO→GRN→PI conversions to preserve variant data
-- (sofa color, bedframe D1/divan/leg/special), every line-item table
-- needs the same variant shape as mfg_sales_order_items (PR #35).
--
-- This migration handles purchase_order_items only. Follow-ups:
--   - 0057: grn_items / purchase_invoice_items / purchase_return_items
--   - 0058: delivery_order_items / sales_invoice_items / consignment_*_items
-- ----------------------------------------------------------------------------

BEGIN;

ALTER TABLE purchase_order_items
  -- Bedframe variant pricing
  ADD COLUMN IF NOT EXISTS gap_inches             INTEGER,
  ADD COLUMN IF NOT EXISTS divan_height_inches    INTEGER,
  ADD COLUMN IF NOT EXISTS divan_price_sen        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leg_height_inches      INTEGER,
  ADD COLUMN IF NOT EXISTS leg_price_sen          INTEGER NOT NULL DEFAULT 0,
  -- Custom specials JSONB (mix of predefined + free-text surcharges)
  ADD COLUMN IF NOT EXISTS custom_specials        JSONB,
  -- Line suffix for modular variants (e.g. -01, -02)
  ADD COLUMN IF NOT EXISTS line_suffix            TEXT,
  ADD COLUMN IF NOT EXISTS special_order_price_sen INTEGER NOT NULL DEFAULT 0,
  -- Free-form variant snapshot (sofa color, fabric color, seat height, etc).
  -- Mirrors mfg_sales_order_items.variants JSONB.
  ADD COLUMN IF NOT EXISTS variants               JSONB,
  -- Item group (used to drive per-category variant editor: sofa / bedframe /
  -- mattress / accessory / service)
  ADD COLUMN IF NOT EXISTS item_group             TEXT,
  -- Description / description2 — most line items already had material_name,
  -- but free-text description lets you override (e.g. "HILTON 6FT — special
  -- divan height per customer note").
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS description2           TEXT,
  -- UoM (default 'UNIT')
  ADD COLUMN IF NOT EXISTS uom                    TEXT NOT NULL DEFAULT 'UNIT',
  -- Discount centi (per-line discount, separate from supplier-level)
  ADD COLUMN IF NOT EXISTS discount_centi         INTEGER NOT NULL DEFAULT 0,
  -- Unit cost (snapshot — supplier may quote a price but our cost can differ)
  ADD COLUMN IF NOT EXISTS unit_cost_centi        INTEGER NOT NULL DEFAULT 0;

COMMIT;
