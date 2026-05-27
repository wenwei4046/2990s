-- 0085 — Add 'venue' to so_dropdown_options category CHECK constraint.
--
-- Commander 2026-05-27: "sales order 还需要开一个 venue 的". SO Venue was
-- previously a free-text field on mfg_sales_orders. Promote to a managed
-- picklist sharing the same so_dropdown_options table introduced in 0081.
--
-- Categories currently allowed (from 0081 + 0083):
--   customer_type · building_type · relationship · payment_method
--   payment_merchant · online_type · installment_plan
-- Adding: venue
--
-- Idempotent: drops + recreates the CHECK constraint. Safe to re-run.

BEGIN;

ALTER TABLE so_dropdown_options
  DROP CONSTRAINT IF EXISTS so_dropdown_options_category_check;

ALTER TABLE so_dropdown_options
  ADD CONSTRAINT so_dropdown_options_category_check
  CHECK (category IN (
    'customer_type',
    'building_type',
    'relationship',
    'payment_method',
    'payment_merchant',
    'online_type',
    'installment_plan',
    'venue'
  ));

-- No seed rows — commander adds venues via SO Maintenance UI.
-- Typical first entries (commander seeds these manually):
--   ('venue', 'PENANG WATERFRONT CC',       'Penang Waterfront CC',       10)
--   ('venue', 'PISA SPICE ARENA',           'PISA SPICE Arena',           20)
--   ('venue', 'SUNWAY PYRAMID CC',          'Sunway Pyramid CC',          30)
--   ('venue', 'MIDVALLEY EXHIBITION CTR',   'Midvalley Exhibition Centre', 40)
--   ('venue', 'KL CONVENTION CENTRE',       'KL Convention Centre',       50)

COMMIT;
