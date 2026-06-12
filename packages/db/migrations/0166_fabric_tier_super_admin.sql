-- 0166_fabric_tier_super_admin.sql
-- super_admin (mig 0162, PR #538) postdates the fabric-tier editor RLS (0124):
-- fabric_tier_addon_config_update_editors whitelists only admin/coordinator/
-- master_account, so a super_admin "Save amounts" was USING-filtered to a
-- 0-row update — no error, nothing written. Add super_admin to the policy.
--
-- fabric_library needs NO change here: its is_admin() ALL policy
-- (fabric_library_admin_write) already covers admin + super_admin.

DROP POLICY IF EXISTS fabric_tier_addon_config_update_editors ON fabric_tier_addon_config;
CREATE POLICY fabric_tier_addon_config_update_editors
  ON fabric_tier_addon_config FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','super_admin','coordinator','master_account')));
