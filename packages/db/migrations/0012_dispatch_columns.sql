-- 0012_dispatch_columns.sql
-- Phase 4 sub-project C: dispatch columns on orders.
-- Both nullable — set by coordinator after order creation.

ALTER TABLE orders
  ADD COLUMN confirmed_delivery_date date,
  ADD COLUMN do_key text;
