import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useHrAccess } from '../lib/houzs-perms';

// Route guard for the OPEX Commission page.
//
// Deliberately NOT MaintainGate. That one gates on the POS role (isGlobalCurator
// — admin / super_admin / master_account), which is the right shape for the
// POS-owned Maintain tooling and the wrong shape here: this page's API is Houzs
// `/hr/*`, which ignores scm.staff.role entirely and gates on the flat key
// `scm.hr.read`. Gating on the role would either show the page to someone the
// server then refuses, or hide it from someone who legitimately holds the key.
//
// Sits INSIDE <AuthGate>, so a session already exists. While the permission read
// is in flight we render a placeholder rather than redirecting — bouncing on
// "not yet known" would kick a legitimate holder back to the catalogue on every
// hard load of the URL.
//
// This is a HIDE, not the gate. The real one is server-side; see lib/houzs-perms.ts.
export const HrGate = ({ children }: { children: ReactNode }) => {
  const { canRead, isLoading } = useHrAccess();
  if (isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!canRead) return <Navigate to="/catalog" replace />;
  return <>{children}</>;
};
