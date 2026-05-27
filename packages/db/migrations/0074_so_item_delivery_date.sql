-- 0074 — Per-item delivery date with cascade override flag (PR-E).
-- Commander 2026-05-27: each line gets its own delivery date that inherits
-- from the SO header by default but can be overridden per line. The
-- overridden flag prevents header-date changes from clobbering manual
-- edits. Same master-follower pattern as the variants cascade.

BEGIN;

ALTER TABLE mfg_sales_order_items
  ADD COLUMN IF NOT EXISTS line_delivery_date date,
  ADD COLUMN IF NOT EXISTS line_delivery_date_overridden boolean NOT NULL DEFAULT false;

COMMIT;
