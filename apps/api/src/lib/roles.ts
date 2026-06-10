// ─────────────────────────────────────────────────────────────────────────
// roles.ts — staff-role tiers used by the API for cross-salesperson access.
//
// "View all sales" tier — the only roles allowed to see EVERY salesperson's
// orders / sales KPIs (and all saved quotes). Owner-level only: super_admin
// (full POS+Backend owner) + master_account (POS selling-side master). Plain
// `admin` is intentionally EXCLUDED here (Loo 2026-06-09) — admins see only
// their own. Keep this list in lockstep with the POS predicate
// `canViewAllSales` in apps/pos/src/lib/staff.ts.
// ─────────────────────────────────────────────────────────────────────────

export const ALL_SALES_VIEWER_ROLES = ['super_admin', 'master_account'] as const;

/** True when this role may view every salesperson's orders/sales (not just own). */
export function canViewAllSales(role: string | null | undefined): boolean {
  return role === 'super_admin' || role === 'master_account';
}

/* TEMPORARY (Loo 2026-06-10, Backend SO emergency hatch) — the POS selling
   roles that reach the Backend Sales Order module through the hatch
   (apps/backend/src/lib/auth.tsx posOnlyAllowedPath). On the Backend SO
   list + detail they are scoped to their OWN orders (salesperson_id =
   caller), mirroring the POS My-orders board. master_account is POS-only
   too but belongs to the view-all tier above, and Backend-native roles
   (coordinator / finance / admin / …) are untouched. Remove together with
   the hatch. */
export function isSelfScopedSales(role: string | null | undefined): boolean {
  return role === 'sales' || role === 'sales_executive' || role === 'outlet_manager';
}
