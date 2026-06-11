-- 0165: explicit per-document line sequence (Loo 2026-06-12, follow-up to PR #569).
--
-- One bulk insert gives every line of a document the IDENTICAL created_at
-- (now() is statement-stable), and routine row updates (stock_status flips,
-- recomputeTotals' combo spread) physically relocate heap tuples — so the
-- listing order persisted at create (mains → accessories → services, sofa
-- modules left-to-right) was unrecoverable from the timestamp.
--
-- line_no is written by the create paths (array index) and by add-line
-- endpoints (max+1, only when the document is already numbered). Legacy rows
-- stay NULL on purpose: reads order by (line_no NULLS LAST, created_at) and
-- the API re-derives the rule order (rank + sofa walk) for them — no backfill.

ALTER TABLE mfg_sales_order_items ADD COLUMN IF NOT EXISTS line_no integer;
ALTER TABLE delivery_order_items  ADD COLUMN IF NOT EXISTS line_no integer;
ALTER TABLE sales_invoice_items   ADD COLUMN IF NOT EXISTS line_no integer;
