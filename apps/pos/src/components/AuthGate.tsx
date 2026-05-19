import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { LockScreen } from '../pages/LockScreen';

// LockScreen handles the common path (PIN). The /login route stays available
// as an emergency email/password gate for admin access.
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!user) return <LockScreen />;
  return <>{children}</>;
};
