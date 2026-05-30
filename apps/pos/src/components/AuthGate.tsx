import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { LockScreen } from '../pages/LockScreen';

// LockScreen handles the common path (PIN). The /login route stays available
// as an emergency email/password gate for admin access.
//
// 2026-05-27 (role-based invite redirect) — invited POS staff land here with
// a Supabase session but no password set yet (`user_metadata.password_set
// === false`, flipped to true once they submit the /set-password form).
// They have no PIN yet either, so the LockScreen fallback would dead-end
// them. Send them to /set-password first; the form flips the flag, and the
// next render falls through to LockScreen / app as normal.
export const AuthGate = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (user && user.user_metadata?.password_set === false) {
    return <Navigate to="/set-password" replace />;
  }
  if (!user) return <LockScreen />;
  return <>{children}</>;
};
