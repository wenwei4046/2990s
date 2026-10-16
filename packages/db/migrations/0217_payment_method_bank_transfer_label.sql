-- 0217 — Drop the "DuitNow" half of the Online payment-method label.
--
-- Loo 2026-09-15: the handover payment card should read "Bank transfer",
-- not "Bank transfer / DuitNow". Label only — the VALUE stays 'Online'
-- (the immutable key, mapped to ledger code 'transfer' in
-- packages/shared/src/payment-methods.ts) and no stored payment row moves.
--
-- Guarded on the exact 0156 wording so a label someone has since customised
-- in SO Maintenance is not clobbered.
--
-- ⚠️ This only re-labels erp.2990shome.com (Backend). Since the 2026-07-21
-- cutover the POS reads /so-dropdown-options from HOUZS (company 2), whose
-- own scm.so_dropdown_options row still says 'Bank transfer / DuitNow'
-- (seeded by their migration 0022). The tablet label is changed either by
-- renaming that row on the POS SO Maintenance page — which writes to Houzs —
-- or by a matching migration in the Houzs repo.

UPDATE so_dropdown_options
SET label = 'Bank transfer'
WHERE category = 'payment_method'
  AND value = 'Online'
  AND label = 'Bank transfer / DuitNow';
