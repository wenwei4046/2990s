import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMarketingAccess } from '../lib/houzs-perms';

// Guard for /marketing. The marketing account, or anyone who could open the
// Maintain tooling (which owned Sales analysis before it moved here). Everyone
// else is bounced to /catalog so a hand-typed URL cannot bypass the hidden
// sidebar section. Sits INSIDE <AuthGate>, so a session already exists.
//
// Same predicate as the sidebar link and as 2990's /marketing API — see
// useMarketingAccess. While the answer is still loading, render a placeholder
// rather than redirect: bouncing on "not yet known" would kick a legitimate
// user back to the catalogue on every hard load of the URL.
export const MarketingGate = ({ children }: { children: ReactNode }) => {
  const { canUseMarketing, isLoading } = useMarketingAccess();
  if (isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!canUseMarketing) return <Navigate to="/catalog" replace />;
  return <>{children}</>;
};
