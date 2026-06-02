-- P1 (Owner 2026-06-03) — carry the POS handover payment slip onto the Sales
-- Order (minimal "coordinator can SEE the slip" version; finance verify flow
-- stays Phase 4). Today the uploaded slip only links to the dead legacy /orders
-- path, so the coordinator never sees the customer's payment proof on the SO.
--
-- Mirrors the legacy orders table's slip columns. On SO create the server
-- resolves the POS uploadSessionId → pending_slip_uploads.r2_key and stores it
-- here as slip_key, with slip_state = 'pending'. Append-only, defaults keep
-- existing rows at slip_state='none' / slip_key=NULL (zero behaviour change).
--
-- Numbered 0143 (after this branch's 0142 signature; current main max = 0141).
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS slip_key text;
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS slip_state slip_state NOT NULL DEFAULT 'none';

COMMENT ON COLUMN mfg_sales_orders.slip_key IS
  'R2 object key of the POS handover payment slip (resolved from pending_slip_uploads at create). NULL when no slip. (migration 0143)';
COMMENT ON COLUMN mfg_sales_orders.slip_state IS
  'Slip review state: none | pending | verified | flagged. POS orders with a slip land at pending; finance verify flow is Phase 4. (migration 0143)';
