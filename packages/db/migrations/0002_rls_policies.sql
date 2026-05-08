-- 0002_rls_policies.sql
-- Codex P1.5 fold (2026-05-08): RLS is Phase 0 mandatory per PORT_DESIGN.md
-- §11.1 Issue 7. ALL tables enable RLS. Per-table policies cover sales /
-- showroom_lead / coordinator / finance / admin scopes. service_role bypasses
-- RLS by default in Supabase.
--
-- Helper functions are SECURITY DEFINER + STABLE so they bypass RLS when
-- evaluating policies and aren't re-run for every row.

-- ─── Role helpers (SECURITY DEFINER bypasses RLS on staff lookup) ──────────

CREATE OR REPLACE FUNCTION is_staff() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM staff WHERE id = auth.uid() AND active = TRUE);
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM staff WHERE id = auth.uid() AND role = 'admin' AND active = TRUE);
$$;

CREATE OR REPLACE FUNCTION is_coordinator_or_above() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM staff WHERE id = auth.uid() AND role IN ('coordinator','finance','admin') AND active = TRUE);
$$;

CREATE OR REPLACE FUNCTION is_finance_or_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM staff WHERE id = auth.uid() AND role IN ('finance','admin') AND active = TRUE);
$$;

CREATE OR REPLACE FUNCTION current_staff_showroom() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT showroom_id FROM staff WHERE id = auth.uid() AND active = TRUE;
$$;

CREATE OR REPLACE FUNCTION current_staff_role() RETURNS staff_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM staff WHERE id = auth.uid() AND active = TRUE;
$$;

-- ─── Enable RLS on all 23 tables ───────────────────────────────────────────
ALTER TABLE addons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_library        ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE compartment_library   ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_localities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lane_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_slip_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_slip_uploads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_bundles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_compartments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_size_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE series                ENABLE ROW LEVEL SECURITY;
ALTER TABLE showrooms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE size_library          ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff                 ENABLE ROW LEVEL SECURITY;

-- ─── app_config — service_role only (no policies = no auth access) ────────
-- (RLS enabled with no policy blocks all anon / authenticated; service_role bypasses.)

-- ─── pending_slip_uploads — service_role only ──────────────────────────────
-- (Same: no policies, service_role bypasses for the reaper Worker.)

-- ─── staff — read for any authenticated, write admin only ──────────────────
CREATE POLICY staff_select_authenticated ON staff
  FOR SELECT TO authenticated
  USING (is_staff());
CREATE POLICY staff_admin_write ON staff
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ─── showrooms — read for any authenticated staff, write admin ─────────────
CREATE POLICY showrooms_select ON showrooms
  FOR SELECT TO authenticated
  USING (is_staff());
CREATE POLICY showrooms_admin_write ON showrooms
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ─── Library tables — read all auth, write admin ───────────────────────────
CREATE POLICY categories_select ON categories
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY categories_admin_write ON categories
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY series_select ON series
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY series_admin_write ON series
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY compartment_library_select ON compartment_library
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY compartment_library_admin_write ON compartment_library
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY bundle_library_select ON bundle_library
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY bundle_library_admin_write ON bundle_library
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY size_library_select ON size_library
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY size_library_admin_write ON size_library
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY my_localities_select ON my_localities
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY my_localities_admin_write ON my_localities
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── Products + pricing tables — read all auth, write admin ────────────────
CREATE POLICY products_select ON products
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY products_admin_write ON products
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY product_compartments_select ON product_compartments
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY product_compartments_admin_write ON product_compartments
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY product_bundles_select ON product_bundles
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY product_bundles_admin_write ON product_bundles
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY product_size_variants_select ON product_size_variants
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY product_size_variants_admin_write ON product_size_variants
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── Addons — same as products ─────────────────────────────────────────────
CREATE POLICY addons_select ON addons
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY addons_admin_write ON addons
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ─── Drivers — read all auth, write coordinator+ ───────────────────────────
CREATE POLICY drivers_select ON drivers
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY drivers_coord_write ON drivers
  FOR ALL TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());

-- ─── Customers — read+insert all auth, update coordinator+, delete admin ───
-- (Sales need INSERT on order placement; SELECT for phone-lookup dedup.)
CREATE POLICY customers_select_insert ON customers
  FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY customers_insert ON customers
  FOR INSERT TO authenticated WITH CHECK (is_staff());
CREATE POLICY customers_update ON customers
  FOR UPDATE TO authenticated
  USING (is_coordinator_or_above()) WITH CHECK (is_coordinator_or_above());
CREATE POLICY customers_admin_delete ON customers
  FOR DELETE TO authenticated USING (is_admin());

-- ─── Orders — sales read+insert own showroom; coordinator+ all ─────────────
CREATE POLICY orders_sales_scope ON orders
  FOR SELECT TO authenticated
  USING (
    is_staff() AND (
      is_coordinator_or_above() OR
      showroom_id = current_staff_showroom()
    )
  );
CREATE POLICY orders_sales_insert ON orders
  FOR INSERT TO authenticated
  WITH CHECK (
    is_staff() AND (
      is_coordinator_or_above() OR
      showroom_id = current_staff_showroom()
    )
  );
CREATE POLICY orders_coord_update ON orders
  FOR UPDATE TO authenticated
  USING (is_coordinator_or_above())
  WITH CHECK (is_coordinator_or_above());
CREATE POLICY orders_admin_delete ON orders
  FOR DELETE TO authenticated USING (is_admin());

-- ─── Order items — same scope as parent order ──────────────────────────────
CREATE POLICY order_items_scope ON order_items
  FOR ALL TO authenticated
  USING (
    is_coordinator_or_above() OR EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.showroom_id = current_staff_showroom()
    )
  )
  WITH CHECK (
    is_coordinator_or_above() OR EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.showroom_id = current_staff_showroom()
    )
  );

-- ─── Order lane history — read scoped to order; insert coordinator+ ────────
CREATE POLICY order_lane_history_scope ON order_lane_history
  FOR SELECT TO authenticated
  USING (
    is_coordinator_or_above() OR EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_lane_history.order_id AND o.showroom_id = current_staff_showroom()
    )
  );
CREATE POLICY order_lane_history_insert ON order_lane_history
  FOR INSERT TO authenticated
  WITH CHECK (is_coordinator_or_above());

-- ─── Order slip events — same as lane history ─────────────────────────────
CREATE POLICY order_slip_events_scope ON order_slip_events
  FOR SELECT TO authenticated
  USING (
    is_coordinator_or_above() OR EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_slip_events.order_id AND o.showroom_id = current_staff_showroom()
    )
  );
CREATE POLICY order_slip_events_insert ON order_slip_events
  FOR INSERT TO authenticated
  WITH CHECK (is_staff());

-- ─── Payments — sales read own showroom orders; finance/coord all ─────────
CREATE POLICY payments_select_scope ON payments
  FOR SELECT TO authenticated
  USING (
    is_coordinator_or_above() OR EXISTS (
      SELECT 1 FROM orders o WHERE o.id = payments.order_id AND o.showroom_id = current_staff_showroom()
    )
  );
CREATE POLICY payments_insert ON payments
  FOR INSERT TO authenticated
  WITH CHECK (is_finance_or_admin() OR is_coordinator_or_above());
CREATE POLICY payments_admin_update_delete ON payments
  FOR UPDATE TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ─── Quotes — sales: own; showroom_lead/coordinator: same showroom; admin: all
CREATE POLICY quotes_sales_own ON quotes
  FOR SELECT TO authenticated
  USING (
    is_admin() OR
    is_coordinator_or_above() OR
    (current_staff_role() = 'showroom_lead' AND showroom_id = current_staff_showroom()) OR
    (current_staff_role() = 'sales' AND created_by = auth.uid())
  );
CREATE POLICY quotes_sales_insert ON quotes
  FOR INSERT TO authenticated
  WITH CHECK (
    is_staff() AND created_by = auth.uid() AND showroom_id = current_staff_showroom()
  );
CREATE POLICY quotes_update ON quotes
  FOR UPDATE TO authenticated
  USING (
    is_admin() OR
    (current_staff_role() = 'sales' AND created_by = auth.uid())
  )
  WITH CHECK (
    is_admin() OR
    (current_staff_role() = 'sales' AND created_by = auth.uid())
  );
CREATE POLICY quotes_delete ON quotes
  FOR DELETE TO authenticated
  USING (
    is_admin() OR
    (current_staff_role() = 'sales' AND created_by = auth.uid())
  );
