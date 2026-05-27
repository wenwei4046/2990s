-- ----------------------------------------------------------------------------
-- 0083 — Payment Method 3-step cascade (Merchant / Online / Cash).
--
-- Commander 2026-05-27 corrected the structure: the Method column on the
-- Payments table should be a cascade, not a flat 10-option pick.
--
--     Method (L1, always shown)
--     ├─ Merchant  → THEN pick Merchant Bank + Installment Plan
--     ├─ Online    → THEN pick Online sub-type (Bank Transfer / TNG /
--     │             Cheque / DuitNow)
--     └─ Cash      → done, no extra fields
--
-- Before this migration, so_dropdown_options.category was constrained to
-- the four original buckets and payment_method held a flat 10-row mix
-- (CASH, MBB, VISA, MASTER, CREDIT CARD, EPP, ONLINE, TNG, DUITNOW, OTHER).
-- The structural shape changes, so we DELETE the old payment_method seed
-- rows and re-seed under the new 3-level model. The category CHECK is
-- widened to admit three new buckets: payment_merchant (the bank list),
-- online_type (the Online sub-type list), and installment_plan.
--
-- mfg_sales_order_payments already has merchant_provider and
-- installment_months columns from migration 0073 — we REUSE them. We add
-- a new nullable online_type column for the Online sub-type (e.g. 'TNG',
-- 'DuitNow'); existing rows pre-cascade leave it NULL.
-- ----------------------------------------------------------------------------

BEGIN;

-- 1. Widen the category CHECK on so_dropdown_options.
ALTER TABLE so_dropdown_options DROP CONSTRAINT IF EXISTS so_dropdown_options_category_check;
ALTER TABLE so_dropdown_options ADD CONSTRAINT so_dropdown_options_category_check
  CHECK (category IN (
    'customer_type',
    'building_type',
    'relationship',
    'payment_method',
    'payment_merchant',
    'online_type',
    'installment_plan'
  ));

-- 2. Clean out the legacy payment_method seed — the values are changing
--    structurally (CASH/MBB/VISA/MASTER/... → Merchant/Online/Cash) so we
--    can't just re-UPSERT new rows on top of the old ones. Historical
--    mfg_sales_order_payments rows use the internal enum (merchant /
--    transfer / cash) on `method`, not these label values, so deleting
--    these dropdown rows does NOT orphan any payment data.
DELETE FROM so_dropdown_options WHERE category = 'payment_method';

-- 3. Seed the new cascade.
INSERT INTO so_dropdown_options (category, value, label, sort_order) VALUES
  -- L1 — Method (the three top-level choices the user always sees first).
  ('payment_method',   'Merchant',     'Merchant',     1),
  ('payment_method',   'Online',       'Online',       2),
  ('payment_method',   'Cash',         'Cash',         3),

  -- L2a — Merchant banks (shown only when Method=Merchant).
  ('payment_merchant', 'MBB',          'MBB',          1),
  ('payment_merchant', 'CIMB',         'CIMB',         2),
  ('payment_merchant', 'Public',       'Public',       3),
  ('payment_merchant', 'HLB',          'HLB',          4),
  ('payment_merchant', 'RHB',          'RHB',          5),
  ('payment_merchant', 'Bank Islam',   'Bank Islam',   6),
  ('payment_merchant', 'BSN',          'BSN',          7),
  ('payment_merchant', 'Alliance',     'Alliance',     8),
  ('payment_merchant', 'AmBank',       'AmBank',       9),

  -- L2b — Online sub-types (shown only when Method=Online).
  ('online_type',      'Bank Transfer', 'Bank Transfer', 1),
  ('online_type',      'TNG',           'TNG',           2),
  ('online_type',      'Cheque',        'Cheque',        3),
  ('online_type',      'DuitNow',       'DuitNow',       4),

  -- L2c — Installment plans (shown alongside Merchant bank when
  -- Method=Merchant). 'One-off' is the default (no installment).
  ('installment_plan', 'One-off',      'One-off',      1),
  ('installment_plan', '3 months',     '3 months',     2),
  ('installment_plan', '6 months',     '6 months',     3),
  ('installment_plan', '12 months',    '12 months',    4),
  ('installment_plan', '24 months',    '24 months',    5),
  ('installment_plan', '36 months',    '36 months',    6)
ON CONFLICT (category, value) DO NOTHING;

-- 4. Add online_type to mfg_sales_order_payments. Nullable — existing rows
--    + future Cash/Merchant rows leave it NULL; only Online rows populate
--    it (one of 'Bank Transfer' / 'TNG' / 'Cheque' / 'DuitNow').
ALTER TABLE mfg_sales_order_payments
  ADD COLUMN IF NOT EXISTS online_type text;

COMMIT;
