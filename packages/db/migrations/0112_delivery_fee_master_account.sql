-- 0112_delivery_fee_master_account.sql
-- Phase 2 · Cost/Sell split (COST-SELL-SPLIT-PLAN.md; Chairman approved 2026-05-30).
--
-- The delivery-fee setting moves from the Backend (admin/coordinator Settings)
-- into the POS "Master Account" selling surface. delivery_fee_config has RLS
-- enabled; its UPDATE policy (from migration 0029) only allowed admin +
-- coordinator, so a master_account write would be denied (42501). This widens
-- that one policy to ALSO allow master_account. The SELECT policy is unchanged
-- (any authenticated staff reads). The API delivery-fees route's WRITE_ROLES is
-- widened in lockstep so the PATCH passes both the app gate and the DB policy.
--
-- Recreate-in-place (DROP + CREATE, same policy name) — never edit 0029's
-- history. Idempotent: DROP ... IF EXISTS guards a re-run.
DROP POLICY IF EXISTS delivery_fee_config_update_admin_coord ON delivery_fee_config;

CREATE POLICY delivery_fee_config_update_admin_coord ON delivery_fee_config
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.id = auth.uid()
        AND staff.active = true
        AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'master_account'::staff_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM staff
      WHERE staff.id = auth.uid()
        AND staff.active = true
        AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'master_account'::staff_role])
    )
  );
