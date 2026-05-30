-- 0036_add_merchant_payment_method.sql
-- Add 'merchant' to the payment_method enum. This MUST be its own migration:
-- Postgres cannot use a newly-added enum value in the same transaction that
-- adds it, so the data migration (credit/debit → merchant) + the RPC recreate
-- live separately in 0037.
--
-- 'merchant' = card payment via a merchant acquirer/terminal (GHL/HLB/MBB/PBB),
-- replacing the old credit/debit split in the POS. credit/debit enum values are
-- kept (Postgres can't drop enum values in use) but become dormant once 0037
-- migrates the existing rows.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'merchant';
