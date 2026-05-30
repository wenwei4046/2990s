import { Suspense, useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router';
import { useAuth, POS_ONLY_ROLES } from '../lib/auth';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { ToastProvider } from './Toast';
import { ErrorBoundary } from './ErrorBoundary';
import { SkeletonDetailPage } from './Skeleton';
import styles from './Layout.module.css';

// Auth-gated layout shell. Redirects to /login if no session, /no-access if
// the user has a session but no matching staff row (e.g. signed up via the
// app but the bootstrap trigger didn't fire because owner_email mismatch).

interface RouteMeta {
  title: string;
  sub: string;
  searchPlaceholder?: string;
}

const ROUTE_META: Record<string, RouteMeta> = {
  '/dashboard': { title: 'Today', sub: 'Coordinator dashboard · Showroom KL' },
  '/audit-log': { title: 'Payment audit log', sub: 'Finance reports' },
  '/addons': { title: 'Add-on products', sub: 'Disposal · Lift · Assembly' },
  '/customers': {
    title: 'Customers',
    sub: 'Internal directory · read-only',
    searchPlaceholder: 'Name, phone, email…',
  },
  '/settings': { title: 'Settings', sub: 'Drivers · Showrooms · Staff' },
};

export const Layout = () => {
  const { user, staff, loading } = useAuth();
  const location = useLocation();

  // Global Ctrl/Cmd+K command palette. Hook runs unconditionally (before any
  // early return) to satisfy the rules of hooks.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loading) return <div className={styles.loading}>Loading…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;

  // PR #48 — first-login onboarding. Invited staff land here via the magic
  // link with `user_metadata.password_set === false` (set by inviteUserByEmail
  // in admin.ts). Force them through /set-password so they have a real password
  // before they can do anything else. Existing users have no flag (undefined),
  // so they're untouched. Recovery sessions land directly on /set-password and
  // never hit this guard.
  if (user.user_metadata?.password_set === false && location.pathname !== '/set-password') {
    return <Navigate to="/set-password" replace />;
  }

  if (!staff) return <Navigate to="/no-access" replace />;

  /* Migration 0086 — POS-only roles (sales / sales_executive / outlet_manager)
     are blocked from the Backend portal at the route guard level. */
  if (POS_ONLY_ROLES.has(staff.role)) {
    return <Navigate to="/no-access" replace />;
  }

  const meta: RouteMeta = ROUTE_META[location.pathname] ?? { title: 'Backend', sub: '' };

  return (
    <ToastProvider>
      <div className={styles.shell}>
        <Sidebar />
        <div className={styles.col}>
          <Topbar
            title={meta.title}
            sub={meta.sub}
            searchPlaceholder={meta.searchPlaceholder}
            onOpenSearch={() => setPaletteOpen(true)}
          />
          <main className={styles.main}>
            {/* Single Suspense boundary for all lazy-loaded route pages.
                See router.tsx — per-route code splitting means each page
                module is fetched on demand, with this fallback shown while
                its chunk downloads. */}
            <Suspense fallback={<SkeletonDetailPage />}>
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </Suspense>
          </main>
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
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
