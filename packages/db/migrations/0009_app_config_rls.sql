-- 0009_app_config_rls.sql
-- Phase 4 step 2: RLS for app_config (clears advisor warning).
-- All staff need to read pricing_version etc; only admin modifies.

CREATE POLICY app_config_select_staff
  ON app_config FOR SELECT TO authenticated
  USING (is_staff());

CREATE POLICY app_config_modify_admin
  ON app_config FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
