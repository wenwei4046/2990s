-- 0017_suppliers_po_rls.sql
-- Phase 4 follow-up: enable RLS on suppliers + purchase_orders + purchase_order_lines + po_sequences.
-- Sub-project D's M3 (0014) and M4 (0015) migrations created these tables but didn't enable RLS,
-- leaving them fully exposed to the anon role. Surfaced via Supabase advisor during Hookka catalog
-- seed (commit 54930d0).
--
-- Pattern mirrors 0013_storage_bucket_dos.sql: uses public.is_coordinator_or_above() and
-- public.is_admin() helpers established in earlier RLS migrations.
--
-- Append-only PO design: no UPDATE/DELETE policies on purchase_orders or purchase_order_lines
-- (per Sub-project D decision D10).

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_sequences ENABLE ROW LEVEL SECURITY;

-- ─── suppliers ───
CREATE POLICY "suppliers_select_coord"
  ON suppliers FOR SELECT TO authenticated
  USING (public.is_coordinator_or_above());

CREATE POLICY "suppliers_insert_coord"
  ON suppliers FOR INSERT TO authenticated
  WITH CHECK (public.is_coordinator_or_above());

CREATE POLICY "suppliers_update_coord"
  ON suppliers FOR UPDATE TO authenticated
  USING (public.is_coordinator_or_above())
  WITH CHECK (public.is_coordinator_or_above());

CREATE POLICY "suppliers_delete_admin"
  ON suppliers FOR DELETE TO authenticated
  USING (public.is_admin());

-- ─── purchase_orders ─── (append-only)
CREATE POLICY "po_select_coord"
  ON purchase_orders FOR SELECT TO authenticated
  USING (public.is_coordinator_or_above());

CREATE POLICY "po_insert_coord"
  ON purchase_orders FOR INSERT TO authenticated
  WITH CHECK (public.is_coordinator_or_above());

-- ─── purchase_order_lines ─── (append-only)
CREATE POLICY "pol_select_coord"
  ON purchase_order_lines FOR SELECT TO authenticated
  USING (public.is_coordinator_or_above());

CREATE POLICY "pol_insert_coord"
  ON purchase_order_lines FOR INSERT TO authenticated
  WITH CHECK (public.is_coordinator_or_above());

-- ─── po_sequences ─── (internal — only next_po_number() SECURITY DEFINER function accesses).
-- RLS enabled with no policies = all direct authenticated/anon access denied.
