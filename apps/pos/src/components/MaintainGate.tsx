import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMaintainAccess } from '../lib/houzs-perms';

// Guard for the MAINTAIN tooling routes (/products, /sales-order-maintenance,
// /new-order, /sales-analysis). Everyone else is bounced to /catalog so a
// hand-typed URL can't bypass the hidden links. Sits INSIDE <AuthGate>, so a
// session already exists.
//
// The predicate is useMaintainAccess, the same one that shows the sidebar
// section in Catalog: the POS curator role OR Houzs's own `scm_config_writer`.
// It used to be isGlobalCurator(staff.role) alone — read the hook's header for
// why a Houzs Title rename silently emptied this page for the owner.
export const MaintainGate = ({ children }: { children: ReactNode }) => {
  const { canMaintain, isLoading } = useMaintainAccess();
  if (isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!canMaintain) return <Navigate to="/catalog" replace />;
  return <>{children}</>;
};
