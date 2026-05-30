-- ----------------------------------------------------------------------------
-- 0110 — master_account staff role
--
-- Phase 2 · Cost/Sell split (COST-SELL-SPLIT-PLAN.md, decision D1).
-- A POS-ONLY selling-side role: the non-owner "Master Account" logs into the
-- POS Products page and edits the customer-facing SELLING price (sell_price_sen,
-- added in 0109) + the per-SKU POS catalog on/off toggle (pos_active, 0111).
-- It is NOT admin-level — no Backend portal access (it joins POS_ONLY_ROLES in
-- app code) and it never sees cost (base_price_sen / price1_sen stay hidden on
-- the POS side).
--
-- Additive only — ADD VALUE on the enum is safe (no dependent view needs
-- recreation). Unlike 0092, this migration does NOT promote any account: Loo
-- assigns master_account to a staff member via the Backend → Users invite UI
-- after apply. (If a promotion is ever scripted, it MUST be a separate
-- statement AFTER the COMMIT — a newly-added enum value can't be used in the
-- same transaction that added it.)
-- ----------------------------------------------------------------------------

BEGIN;

-- Add the enum value (idempotent — IF NOT EXISTS guards re-runs).
ALTER TYPE staff_role ADD VALUE IF NOT EXISTS 'master_account';

COMMIT;
