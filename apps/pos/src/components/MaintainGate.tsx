import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useStaff, isGlobalCurator } from '../lib/staff';

// Role guard for the MAINTAIN tooling routes (/products, /sales-order-maintenance,
// /new-order). Only master-admin roles — admin / super_admin / master_account
// (isGlobalCurator, the same predicate that hides the sidebar section in
// Catalog) — may open these pages. Everyone else is bounced to /catalog so a
// hand-typed URL can't bypass the hidden links. Sits INSIDE <AuthGate>, so a
// session already exists and useStaff() resolves (cached, staleTime 5 min).
export const MaintainGate = ({ children }: { children: ReactNode }) => {
  const { data: staff, isLoading } = useStaff();
  if (isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!isGlobalCurator(staff?.role)) return <Navigate to="/catalog" replace />;
  return <>{children}</>;
};
