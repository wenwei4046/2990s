import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import {
  LayoutDashboard,
  Inbox,
  FileSpreadsheet,
  Package,
  Package2,
  PlusCircle,
  UsersRound,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useNotificationStore } from '../lib/notifications';
import { useOrders } from '../lib/queries';
import styles from './Sidebar.module.css';

type NavRow =
  | { kind: 'group'; label: string }
  | {
      kind: 'link';
      to: string;
      icon: ReactNode;
      label: string;
      badge?: number;
      badgeMuted?: boolean;
    };

const ICON_PROPS = { size: 20, strokeWidth: 1.75 } as const;

const formatRole = (role?: string | null): string => {
  if (!role) return 'Backend';
  const map: Record<string, string> = {
    sales: 'Sales',
    showroom_lead: 'Showroom Lead',
    coordinator: 'Order Coordinator',
    finance: 'Finance',
    admin: 'Administrator',
  };
  return map[role] ?? role;
};

export const Sidebar = () => {
  const { staff, signOut } = useAuth();
  const { data: orders } = useOrders();
  const ordersReadAt = useNotificationStore((s) => s.ordersReadAt);

  const ordersBadge =
    orders?.filter((o) => {
      if (o.lane !== 'received' && o.lane !== 'proceed') return false;
      if (ordersReadAt && o.placedAt <= ordersReadAt) return false;
      return true;
    }).length ?? 0;
  const items: NavRow[] = [
    { kind: 'group', label: 'Workspace' },
    { kind: 'link', to: '/dashboard', icon: <LayoutDashboard {...ICON_PROPS} />, label: 'Dashboard' },
    {
      kind: 'link',
      to: '/orders',
      icon: <Inbox {...ICON_PROPS} />,
      label: 'Orders',
      badge: ordersBadge,
    },
    ...(staff && ['finance', 'coordinator', 'admin'].includes(staff.role)
      ? [{
          kind: 'link' as const,
          to: '/audit-log',
          icon: <FileSpreadsheet {...ICON_PROPS} />,
          label: 'Payment audit log',
        }]
      : []),
    { kind: 'group', label: 'Catalog' },
    { kind: 'link', to: '/sku-master', icon: <Package {...ICON_PROPS} />, label: 'SKU master' },
    { kind: 'link', to: '/products', icon: <Package2 {...ICON_PROPS} />, label: 'Products & Maintenance' },
    { kind: 'link', to: '/addons', icon: <PlusCircle {...ICON_PROPS} />, label: 'Add-on products' },
    { kind: 'group', label: 'Reference' },
    { kind: 'link', to: '/customers', icon: <UsersRound {...ICON_PROPS} />, label: 'Customers' },
    { kind: 'link', to: '/settings', icon: <Settings {...ICON_PROPS} />, label: 'Settings' },
  ];

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>
          2990<span className={styles.wordmarkRing}>S</span>
        </span>
      </div>
      <div className={styles.roleHint}>
        Backend portal
        <strong>{formatRole(staff?.role)}</strong>
      </div>

      <nav className={styles.nav}>
        {items.map((it, i) =>
          it.kind === 'group' ? (
            <div key={`g-${i}`} className={styles.navGroup}>
              {it.label}
            </div>
          ) : (
            <NavLink
              key={it.to}
              to={it.to}
              className={({ isActive }) =>
                isActive ? `${styles.navItem} ${styles.active}` : styles.navItem
              }
            >
              {it.icon}
              <span className={styles.navLabel}>{it.label}</span>
              {it.badge != null && it.badge > 0 && (
                <span
                  className={`${styles.navBadge} ${it.badgeMuted ? styles.navBadgeGhost : ''}`}
                >
                  {it.badge}
                </span>
              )}
            </NavLink>
          ),
        )}
      </nav>

      <div className={styles.footer}>
        {staff && (
          <div className={styles.user}>
            <span className={styles.avatar} style={{ background: staff.color }}>
              {staff.initials}
            </span>
            <div className={styles.userMeta}>
              <strong className="t-body-sm">{staff.name}</strong>
              <small className="t-caption">{formatRole(staff.role)}</small>
            </div>
          </div>
        )}
        <button onClick={() => void signOut()} className={styles.signOut} type="button">
          <LogOut size={16} strokeWidth={1.75} />
          <span className={styles.navLabel}>Sign out</span>
        </button>
      </div>
    </aside>
  );
};
