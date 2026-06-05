-- 0156 — Payment method L1 unified across POS handover + Backend cascade.
--
-- Loo 2026-06-06: the POS handover cards and the SO Maintenance
-- payment_method list must be ONE list, decided from SO Maintenance. The
-- four core rows become a locked set (rename/reorder only — the API now
-- blocks add/delete/deactivate for this category) and each VALUE maps to an
-- internal ledger code in packages/shared/src/payment-methods.ts:
--   Merchant → merchant · Online → transfer · Installment → installment ·
--   Cash → cash
--
-- 1. Installment becomes a first-class L1 row. POS has always treated it as
--    its own method and the deposit ledger already stores
--    method='installment' — only the maintenance list (and therefore the
--    Backend Payments cascade) was missing it.
-- 2. The Online row's display label aligns with the POS card wording.
--    Value stays 'Online' — it is the immutable key. Guarded so a custom
--    label someone already set is not clobbered.
-- 3. Cash moves to sort 4 so the L1 order matches the POS card order
--    (Merchant · Online · Installment · Cash).

INSERT INTO so_dropdown_options (category, value, label, sort_order, active)
VALUES ('payment_method', 'Installment', 'Installment', 3, true)
ON CONFLICT (category, value) DO UPDATE SET active = true;

UPDATE so_dropdown_options
SET label = 'Bank transfer / DuitNow'
WHERE category = 'payment_method' AND value = 'Online' AND label = 'Online';

UPDATE so_dropdown_options
SET sort_order = 4
WHERE category = 'payment_method' AND value = 'Cash';
