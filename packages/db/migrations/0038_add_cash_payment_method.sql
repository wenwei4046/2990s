-- 0038_add_cash_payment_method.sql
-- Add 'cash' to the payment_method enum (POS now offers a Cash method). No RPC
-- change needed: create_order_with_items casts paymentMethod to the enum and
-- the slip / approval rules apply uniformly. Separate migration because Postgres
-- can't use a newly-added enum value in the same transaction that adds it.
ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'cash';
