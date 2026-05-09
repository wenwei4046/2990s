-- 0016_orders_po_columns.sql
-- Phase 4 sub-project D: orders gains po_issued cached flag + audit cols.
-- po_issued is set by API when first PO line references the order.
-- Step-back from ready→logistics retains the flag (D9 in spec decision log).

ALTER TABLE orders
  ADD COLUMN po_issued BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN po_issued_at TIMESTAMPTZ,
  ADD COLUMN po_issued_by UUID REFERENCES staff(id) ON DELETE RESTRICT;
