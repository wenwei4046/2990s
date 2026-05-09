import { Outlet, Navigate, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastProvider } from './Toast';
import styles from './Layout.module.css';

// Auth-gated layout shell. Redirects to /login if no session, /no-access if
// the user has a session but no matching staff row (e.g. signed up via the
// app but the bootstrap trigger didn't fire because owner_email mismatch).

const ROUTE_META: Record<string, { title: string; sub: string }> = {
  '/dashboard': { title: 'Today', sub: 'Coordinator dashboard · Showroom KL' },
  '/orders': { title: 'Orders', sub: '6-lane workflow · all showrooms' },
  '/verify-slips': { title: 'Verify slips', sub: 'Awaiting payment slip check' },
  '/sku-master': { title: 'SKU master', sub: 'Catalog & per-Model pricing' },
  '/addons': { title: 'Add-on products', sub: 'Disposal · Lift · Assembly' },
  '/customers': { title: 'Customers', sub: 'Internal directory · read-only' },
  '/settings': { title: 'Settings', sub: 'Drivers · Showrooms · Staff' },
};

export const Layout = () => {
  const { user, staff, loading } = useAuth();
  const location = useLocation();

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!staff) return <Navigate to="/no-access" replace />;

  const meta = ROUTE_META[location.pathname] ?? { title: 'Backend', sub: '' };

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <Sidebar />
        <div className={styles.col}>
          <Topbar title={meta.title} sub={meta.sub} />
          <main className={styles.main}>
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
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
