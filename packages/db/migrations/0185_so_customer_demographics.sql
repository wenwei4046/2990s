-- 0185_so_customer_demographics.sql
-- Marketing data collection (2026-06-25): capture the customer's race + age
-- band at POS handover. Stored on the SO snapshot, mirroring the emergency-
-- contact precedent (the customers registry has no such columns). Required for
-- NEW customers in the POS Customer step; never shown on the SO / PDF. Read by
-- the Sales Analysis marketing list (each customer's most-recent SO snapshot).
-- Both nullable; existing rows stay NULL. age_frame stores a stable CODE
-- (below_18 / 18_25 / 26_35 / 36_45 / above_45); race stores the value.

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_race text;

ALTER TABLE mfg_sales_orders
  ADD COLUMN IF NOT EXISTS customer_age_frame text;
