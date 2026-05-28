import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import {
  LayoutDashboard,
  Inbox,
  FileSpreadsheet,
  Package,
  Package2,
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
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import styles from './Sidebar.module.css';

type NavLinkRow = {
  to: string;
  icon: ReactNode;
  label: string;
  badge?: number;
  badgeMuted?: boolean;
};

/* A collapsible module inside Supply Chain Management. */
type NavSection = {
  id: string;
  label: string;
  items: NavLinkRow[];
};

const ICON_PROPS = { size: 20, strokeWidth: 1.75 } as const;

/* Collapse state persists per-section so a user's expand/collapse choices
   survive reloads + navigation. Default = all expanded (nothing hidden on
   first load). Keyed by section id under one localStorage entry. */
const COLLAPSE_KEY = 'sidebar.scm.collapsed.v1';
const readCollapsed = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
};

const formatRole = (role?: string | null): string => {
  if (!role) return 'Backend';
  const map: Record<string, string> = {
    sales: 'Sales',
    showroom_lead: 'Showroom Lead',
    coordinator: 'Order Coordinator',
    finance: 'Finance',
    admin: 'Administrator',
    // Migration 0086 — sales-force expansion.
    sales_executive: 'Sales Executive',
    outlet_manager:  'Outlet Manager',
    sales_director:  'Sales Director',
  };
  return map[role] ?? role;
};

export const Sidebar = () => {
  const { staff, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* storage disabled — collapse still works for the session */
      }
      return next;
    });

  const canSeeAuditLog =
    !!staff && ['finance', 'coordinator', 'admin', 'super_admin'].includes(staff.role);
  const canSeeAdmin =
    !!staff && ['admin', 'sales_director', 'coordinator', 'super_admin'].includes(staff.role);

  /* ── Top-level workspace links (outside Supply Chain Management) ── */
  const workspace: NavLinkRow[] = [
    { to: '/dashboard', icon: <LayoutDashboard {...ICON_PROPS} />, label: 'Dashboard' },
    { to: '/orders', icon: <Inbox {...ICON_PROPS} />, label: 'Orders' },
    ...(canSeeAuditLog
      ? [{ to: '/audit-log', icon: <FileSpreadsheet {...ICON_PROPS} />, label: 'Payment audit log' }]
      : []),
  ];

  /* ── Supply Chain Management — 5 collapsible modules, ordered by the
        commander's importance ranking (SO → Procurement → Transport →
        Warehouse → Consignment). 2026-05-28. ──

     NOTE (Phase 1b, 2026-05-28): "SO Maintenance" now lives as a button on
     the Sales Orders page (next to "New Sales Order"), and "Fabric Converter"
     is now a tab inside Products & Maintenance (next to Combo Pricing) — both
     removed from the sidebar here. */
  const supplyChain: NavSection[] = [
    {
      id: 'so',
      label: 'Sales Order Management',
      items: [
        { to: '/mfg-sales-orders', icon: <ClipboardList {...ICON_PROPS} />, label: 'Sales Orders' },
        { to: '/reports/sales-order-detail-listing', icon: <FileBarChart {...ICON_PROPS} />, label: 'SO Detail View' },
        { to: '/sales-invoices', icon: <FileText {...ICON_PROPS} />, label: 'Sales Invoices' },
      ],
    },
    {
      id: 'procurement',
      label: 'Procurement Management',
      items: [
        { to: '/sku-master', icon: <Package {...ICON_PROPS} />, label: 'SKU master' },
        { to: '/products', icon: <Package2 {...ICON_PROPS} />, label: 'Products & Maintenance' },
        { to: '/suppliers', icon: <Truck {...ICON_PROPS} />, label: 'Suppliers' },
        { to: '/purchase-orders', icon: <ScrollText {...ICON_PROPS} />, label: 'Purchase Orders' },
        { to: '/grns', icon: <PackageCheck {...ICON_PROPS} />, label: 'Goods Receipt' },
        { to: '/purchase-invoices', icon: <Receipt {...ICON_PROPS} />, label: 'Purchase Invoices' },
        { to: '/purchase-returns', icon: <Undo2 {...ICON_PROPS} />, label: 'Purchase Returns' },
      ],
    },
    {
      id: 'transportation',
      label: 'Transportation Management',
      items: [
        { to: '/mfg-delivery-orders', icon: <PackagePlus {...ICON_PROPS} />, label: 'Delivery Orders' },
        { to: '/drivers', icon: <Truck {...ICON_PROPS} />, label: 'Drivers' },
        { to: '/delivery-returns', icon: <Undo2 {...ICON_PROPS} />, label: 'Delivery Returns' },
      ],
    },
    {
      id: 'warehouse',
      label: 'Warehouse Management',
      items: [
        { to: '/inventory', icon: <Boxes {...ICON_PROPS} />, label: 'Inventory' },
        { to: '/inventory/adjustments', icon: <SlidersHorizontal {...ICON_PROPS} />, label: 'Adjustments' },
        { to: '/inventory/transfers', icon: <ArrowLeftRight {...ICON_PROPS} />, label: 'Transfers' },
        { to: '/inventory/stock-takes', icon: <ClipboardCheck {...ICON_PROPS} />, label: 'Stock Take' },
        // Phase 3 — rack/bin Warehouse view (Rack Layout · Stock In-Out ·
        // Movement History) ported from Hookka ERP lands here.
      ],
    },
    {
      id: 'consignment',
      label: 'Consignment Management',
      items: [
        { to: '/consignment', icon: <Boxes {...ICON_PROPS} />, label: 'Consignment' },
      ],
    },
  ];

  /* ── Plain groups kept outside Supply Chain Management ── */
  const finance: NavLinkRow[] = [
    { to: '/accounting', icon: <BookOpen {...ICON_PROPS} />, label: 'Accounting' },
    { to: '/outstanding', icon: <AlertCircle {...ICON_PROPS} />, label: 'Outstanding' },
  ];
  const reference: NavLinkRow[] = [
    { to: '/customers', icon: <UsersRound {...ICON_PROPS} />, label: 'Customers' },
    { to: '/settings', icon: <Settings {...ICON_PROPS} />, label: 'Settings' },
  ];

  const renderLink = (it: NavLinkRow) => (
    <NavLink
      key={it.to}
      to={it.to}
      className={({ isActive }) => (isActive ? `${styles.navItem} ${styles.active}` : styles.navItem)}
    >
      {it.icon}
      <span className={styles.navLabel}>{it.label}</span>
      {it.badge != null && it.badge > 0 && (
        <span className={`${styles.navBadge} ${it.badgeMuted ? styles.navBadgeGhost : ''}`}>
          {it.badge}
        </span>
      )}
    </NavLink>
  );

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
        {/* Workspace */}
        <div className={styles.navGroup}>Workspace</div>
        {workspace.map(renderLink)}

        {/* Supply Chain Management — collapsible modules */}
        <div className={styles.scmHeader}>Supply Chain Management</div>
        {supplyChain.map((sec) => {
          const isCollapsed = !!collapsed[sec.id];
          return (
            <div key={sec.id} className={styles.section}>
              <button
                type="button"
                className={styles.sectionHeader}
                onClick={() => toggle(sec.id)}
                aria-expanded={!isCollapsed}
              >
                <span>{sec.label}</span>
                <ChevronDown
                  size={16}
                  strokeWidth={2}
                  className={`${styles.sectionChevron} ${isCollapsed ? styles.sectionChevronClosed : ''}`}
                />
              </button>
              <div className={`${styles.sectionItems} ${isCollapsed ? styles.collapsed : ''}`}>
                {sec.items.map(renderLink)}
              </div>
            </div>
          );
        })}

        {/* Finance */}
        <div className={styles.navGroup}>Finance</div>
        {finance.map(renderLink)}

        {/* Reference */}
        <div className={styles.navGroup}>Reference</div>
        {reference.map(renderLink)}

        {/* Administration (gated) */}
        {canSeeAdmin && (
          <>
            <div className={styles.navGroup}>Administration</div>
            {renderLink({ to: '/users', icon: <ShieldCheck {...ICON_PROPS} />, label: 'Users' })}
          </>
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
