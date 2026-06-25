-- ----------------------------------------------------------------------------
-- 0194 — Re-add the 'DRAFT' status value to all 6 document status enums.
--
-- Owner 2026-06-25: bring the DRAFT/Confirmed two-state back to SO / DO / SI /
-- PO / GRN / PI (porting Houzs's GUARDED version — a DRAFT doc commits nothing
-- until Confirm, and leak-guards keep it out of KPI/MRP/stock/AR/payments).
-- 2990 had deliberately stopped USING draft; some enums kept the value, some
-- dropped it. `ADD VALUE IF NOT EXISTS` is idempotent — a no-op where the value
-- already exists (e.g. mfg_so_status), adds it where it was dropped.
--
-- NOTE: `ALTER TYPE ... ADD VALUE` cannot be used in the SAME transaction that
-- adds it, and is fine to ADD outside a txn. Run these as individual
-- auto-committing statements (no BEGIN/COMMIT wrapper). The actual DRAFT
-- create/confirm/leak-guard code ships separately (migrate-before-deploy: apply
-- this BEFORE deploying the API/UI that writes status='DRAFT').
-- ----------------------------------------------------------------------------

ALTER TYPE mfg_so_status          ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE do_status              ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE sales_invoice_status   ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE po_status              ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE grn_status             ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE purchase_invoice_status ADD VALUE IF NOT EXISTS 'DRAFT';
