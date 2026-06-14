-- 0173_master_account_to_sales_director_rls.sql
-- Retire master_account by folding its capabilities into sales_director.
-- Replaces master_account with sales_director in every RLS policy that
-- references it (14 policies / 9 tables, sourced from live pg_policies on
-- 2026-06-15). Uses ALTER POLICY so ONLY the role list changes — the policy
-- name, command, and target roles (TO) are left exactly as-is.
--
-- The master_account enum value is intentionally NOT dropped from staff_role
-- (Postgres enum-value removal is disruptive; historical rows may reference
-- it). After this migration + the staff data migration, no active staff carry
-- master_account, so the value is dormant.
--
-- App-layer WRITE_ROLES (8 API routes) were updated to sales_director in the
-- same change set; this keeps RLS (direct-client reads/writes) consistent.
--
-- PROD RED-LINE: confirm before applying. Idempotent (re-running is a no-op).

BEGIN;

-- helper role lists after the swap:
--   A = {admin, coordinator, sales_director}
--   B = {admin, super_admin, coordinator, sales_director}

-- 1. delivery_fee_config (A) — UPDATE
ALTER POLICY delivery_fee_config_update_admin_coord ON delivery_fee_config
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 2. fabric_colours (A) — INSERT
ALTER POLICY fabric_colours_insert_editors ON fabric_colours
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 3. fabric_library (A) — INSERT
ALTER POLICY fabric_library_insert_editors ON fabric_library
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 4. fabric_library (A) — UPDATE
ALTER POLICY fabric_library_update_editors ON fabric_library
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 5. fabric_tier_addon_config (B) — UPDATE
ALTER POLICY fabric_tier_addon_config_update_editors ON fabric_tier_addon_config
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 6. model_fabric_tier_overrides (B) — ALL  (per-model fabric tier, PR #601)
ALTER POLICY mfto_write_editors ON model_fabric_tier_overrides
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 7. model_special_delivery_fees (A) — ALL
ALTER POLICY msdf_write_fee_editors ON model_special_delivery_fees
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 8. pwp_rules (B) — DELETE
ALTER POLICY pwp_rules_delete_editors ON pwp_rules
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 9. pwp_rules (B) — INSERT
ALTER POLICY pwp_rules_insert_editors ON pwp_rules
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 10. pwp_rules (B) — UPDATE
ALTER POLICY pwp_rules_update_editors ON pwp_rules
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 11. quotes — SELECT (owner-tier visibility)
ALTER POLICY quotes_sales_own ON quotes
  USING (((current_staff_role() = ANY (ARRAY['super_admin'::staff_role, 'sales_director'::staff_role])) OR (created_by = auth.uid())));

-- 12. special_addons (B) — DELETE
ALTER POLICY special_addons_delete_editors ON special_addons
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 13. special_addons (B) — INSERT
ALTER POLICY special_addons_insert_editors ON special_addons
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

-- 14. special_addons (B) — UPDATE
ALTER POLICY special_addons_update_editors ON special_addons
  USING      (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE staff.id = auth.uid() AND staff.active = true AND staff.role = ANY (ARRAY['admin'::staff_role, 'super_admin'::staff_role, 'coordinator'::staff_role, 'sales_director'::staff_role])));

COMMIT;
