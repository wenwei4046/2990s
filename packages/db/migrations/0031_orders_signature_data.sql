-- 0031_orders_signature_data.sql
-- Persist the customer's e-signature so the Sales Order PDF can reproduce
-- it 1:1. Currently the Handover SignaturePad captures ink as canvas but
-- discards the pixels on submit — only a "signed: boolean" flag lives in
-- the order. Loo's reference template (2026-05-22) embeds the signature
-- image directly on the printed SO, so we store the data URL.
--
-- Format: base64 PNG data URL (~10–30 KB per signature, depending on ink
-- density at 800×200 px). Acceptable inline at pilot volume; migrate to
-- R2 (signature_key column) if the orders table starts to bloat.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS signature_data text;

COMMENT ON COLUMN orders.signature_data IS
  'Customer e-signature captured at handover, stored as a base64 PNG data URL. Embedded into the printed Sales Order. NULL for orders placed before this column was added or where signing was bypassed.';
