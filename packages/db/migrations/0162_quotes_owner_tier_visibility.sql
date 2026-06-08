-- ----------------------------------------------------------------------------
-- 0162 — quotes visibility: owner-tier sees all, everyone else sees own
--
-- Loo 2026-06-09. Previously the quotes SELECT policy let admin / coordinator /
-- finance / showroom_lead see EVERY saved quote (via is_admin() /
-- is_coordinator_or_above() / showroom match). New rule: only the owner tier —
-- super_admin + master_account — sees every quote; ALL other roles (including
-- plain `admin`) see only the quotes they created.
--
-- This also fixes a latent hole: master_account was in NO role helper, so it
-- previously saw ZERO quotes. It now joins super_admin as a full-visibility
-- viewer. Surgical: only the SELECT policy changes — INSERT/UPDATE/DELETE
-- policies (which still use is_admin()/own) are left untouched.
-- ----------------------------------------------------------------------------

BEGIN;

DROP POLICY IF EXISTS quotes_sales_own ON quotes;

CREATE POLICY quotes_sales_own ON quotes
  FOR SELECT TO authenticated
  USING (
    current_staff_role() IN ('super_admin', 'master_account')
    OR created_by = auth.uid()
  );

COMMIT;
