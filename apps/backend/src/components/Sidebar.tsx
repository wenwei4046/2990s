import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import {
  LayoutDashboard,
  Inbox,
  FileSpreadsheet,
  Package,
  Package2,
  Layers,
  PlusCircle,
  UsersRound,
  Truck,
  ScrollText,
  PackageCheck,
  Receipt,
  BookOpen,
  AlertCircle,
  ClipboardList,
  PackagePlus,
  FileText,
  Boxes,
  Undo2,
  SlidersHorizontal,
  ArrowLeftRight,
  ClipboardCheck,
  Settings,
  LogOut,
  FileBarChart,
  Wrench,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
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

  // Orders badge count dropped (perf-router-realtime-sidebar). The previous
  // useOrders() call here fetched every order's full payload on every shell
  // mount just to compute a single unread count — orders of magnitude more
  // data than a badge needs. If we want the badge back later, expose a
  // /orders/counts aggregate endpoint (or a Supabase head/exact count query)
  // and call that instead.
  const items: NavRow[] = [
    { kind: 'group', label: 'Workspace' },
    { kind: 'link', to: '/dashboard', icon: <LayoutDashboard {...ICON_PROPS} />, label: 'Dashboard' },
    {
      kind: 'link',
      to: '/orders',
      icon: <Inbox {...ICON_PROPS} />,
      label: 'Orders',
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
    // Models entry removed — lives inside Products & Maintenance as a third
    // tab next to SKU Master and Maintenance. Route /product-models still
    // works for direct links (Model Detail back-link uses it).
    { kind: 'link', to: '/fabric-tracking', icon: <Layers {...ICON_PROPS} />, label: 'Fabric Converter' },
    { kind: 'link', to: '/inventory', icon: <Boxes {...ICON_PROPS} />, label: 'Inventory' },
    // Stock Adjustments sits under Catalog/Inventory — manual corrections
    // (write-off / found / damage / recount fix) write to inventory_movements.
    { kind: 'link', to: '/inventory/adjustments', icon: <SlidersHorizontal {...ICON_PROPS} />, label: 'Adjustments' },
    // Stock Transfers — move qty between warehouses with paired OUT+IN movements.
    { kind: 'link', to: '/inventory/transfers', icon: <ArrowLeftRight {...ICON_PROPS} />, label: 'Transfers' },
    // Stock Takes (Inv PR5) — AutoCount-style cycle count → ADJUSTMENT movements.
    { kind: 'link', to: '/inventory/stock-takes', icon: <ClipboardCheck {...ICON_PROPS} />, label: 'Stock Take' },
    // Warehouses sidebar entry removed (PR #38) — it's now a sub-tab inside
    // /inventory. Route still exists if someone has it bookmarked.
    // Add-on products page is consolidated into Products & Maintenance — sidebar
    // entry removed per commander 2026-05-25. Route still exists if linked
    // from elsewhere; just hidden from nav.
    { kind: 'group', label: 'Procurement' },
    { kind: 'link', to: '/suppliers', icon: <Truck {...ICON_PROPS} />, label: 'Suppliers' },
    { kind: 'link', to: '/purchase-orders', icon: <ScrollText {...ICON_PROPS} />, label: 'Purchase Orders' },
    { kind: 'link', to: '/grns', icon: <PackageCheck {...ICON_PROPS} />, label: 'Goods Receipt' },
    { kind: 'link', to: '/purchase-invoices', icon: <Receipt {...ICON_PROPS} />, label: 'Purchase Invoices' },
    { kind: 'link', to: '/purchase-returns', icon: <Undo2 {...ICON_PROPS} />, label: 'Purchase Returns' },
    { kind: 'group', label: 'B2B Sales' },
    { kind: 'link', to: '/mfg-sales-orders', icon: <ClipboardList {...ICON_PROPS} />, label: 'Sales Orders' },
    /* Task #110 — SO Maintenance (formerly Settings → Localities tab).
       State → warehouse mapping + cascading customer-address dropdowns
       that only the SO module consumes. */
    { kind: 'link', to: '/mfg-sales-orders/maintenance', icon: <Wrench {...ICON_PROPS} />, label: 'SO Maintenance' },
    /* Commander 2026-05-27: "Sales Order Detail Listing 也是 under sales order".
       Detail Listing is the line-item view of the same SOs — belongs under
       B2B Sales, not a separate Reports group. */
    { kind: 'link', to: '/reports/sales-order-detail-listing', icon: <FileBarChart {...ICON_PROPS} />, label: 'SO Detail View (line items)' },
    { kind: 'link', to: '/mfg-delivery-orders', icon: <PackagePlus {...ICON_PROPS} />, label: 'Delivery Orders' },
    { kind: 'link', to: '/drivers', icon: <Truck {...ICON_PROPS} />, label: 'Drivers' },
    { kind: 'link', to: '/sales-invoices', icon: <FileText {...ICON_PROPS} />, label: 'Sales Invoices' },
    { kind: 'link', to: '/consignment', icon: <Boxes {...ICON_PROPS} />, label: 'Consignment' },
    { kind: 'link', to: '/delivery-returns', icon: <Undo2 {...ICON_PROPS} />, label: 'Delivery Returns' },
    { kind: 'group', label: 'Finance' },
    { kind: 'link', to: '/accounting', icon: <BookOpen {...ICON_PROPS} />, label: 'Accounting' },
    { kind: 'link', to: '/outstanding', icon: <AlertCircle {...ICON_PROPS} />, label: 'Outstanding' },
    /* Commander 2026-05-27: dropped the Reports group entirely.
       - "Sales Order Listing" was redundant with /mfg-sales-orders
       - "Sales Order Detail Listing" moved up under B2B Sales (line-item view)
       - "Outstanding Listing" was just a filter on /outstanding which already lives under Finance */
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
