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
