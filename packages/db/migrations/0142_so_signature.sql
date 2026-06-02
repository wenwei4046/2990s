-- P1 (Owner 2026-06-03) — carry the POS handover customer signature onto the
-- Sales Order. Today the signature is captured at handover but only ever sent
-- to the dead legacy /orders path, so the coordinator never sees it on the SO.
--
-- Single nullable text column holding the signature as a data URL
-- (image/png;base64,...), mirroring the existing customer_po_image_b64 pattern.
-- Append-only, no default → existing rows are unaffected (NULL), zero behaviour
-- change until the POS starts sending it.
--
-- Numbered 0142 (current main max = 0141 / delivery-fee). A sibling branch
-- (special-addons) holds an unmerged 0134 — reconcile ledger order at apply
-- time; this file collides with nothing on main.
ALTER TABLE mfg_sales_orders ADD COLUMN IF NOT EXISTS signature_b64 text;

COMMENT ON COLUMN mfg_sales_orders.signature_b64 IS
  'POS handover customer signature as a data URL (image/png base64). NULL for non-POS or unsigned SOs. (migration 0142)';
