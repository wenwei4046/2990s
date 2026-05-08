import { Outlet, Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { Sidebar } from './Sidebar';
import styles from './Layout.module.css';

// Auth-gated layout shell. Redirects to /login if no session, /no-access if
// the user has a session but no matching staff row (e.g. signed up via the
// app but the bootstrap trigger didn't fire because owner_email mismatch).
export const Layout = () => {
  const { user, staff, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!staff) return <Navigate to="/no-access" replace />;

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
};

export const NoAccess = () => {
  const { user, signOut } = useAuth();
  return (
    <main className={styles.noAccess}>
      <h1 className="t-h2">No staff record</h1>
      <p className="t-body fg-muted">
        Your auth user ({user?.email}) is not linked to a staff row. Have an admin add you via
        the SKU Master / Staff page, or via Supabase Dashboard → Auth → Users.
      </p>
      <button onClick={() => void signOut()} className={styles.signOutBtn} type="button">
        Sign out
      </button>
    </main>
  );
};
