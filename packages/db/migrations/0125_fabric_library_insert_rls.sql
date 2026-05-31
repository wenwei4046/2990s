-- 0125_fabric_library_insert_rls.sql
-- Backend "+ New Fabric" now ALSO creates the customer-pickable fabric_library
-- row + its fabric_colours, so a Backend-added fabric is immediately pickable +
-- coloured on POS. is_admin() (existing *_admin_write ALL) already covers
-- admin/super_admin INSERT; this adds coordinator + master_account for the
-- editor set. (Chairman 2026-06-01 "b ok".) Both tables already have RLS on +
-- a SELECT(is_staff) policy. Cost/procurement (fabric_trackings) untouched.

CREATE POLICY fabric_library_insert_editors
  ON fabric_library FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')));

CREATE POLICY fabric_colours_insert_editors
  ON fabric_colours FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE AND role IN ('admin','coordinator','master_account')));
