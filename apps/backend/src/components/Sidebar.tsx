import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router';
import {
  LayoutDashboard,
  FileSpreadsheet,
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
  Warehouse,
  Settings,
  LogOut,
  FileBarChart,
  ShieldCheck,
  ChevronDown,
  ListTree,
  Activity,
  Handshake,
  Wallet,
} from 'lucide-react';
import { useAuth, POS_ONLY_ROLES } from '../lib/auth';
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
    super_admin:     'Super Admin',
    master_account:  'Master Account',
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
  // HR / commission carries salary data — admin + super_admin only.
  const canSeeHr = !!staff && ['admin', 'super_admin'].includes(staff.role);

  /* TEMPORARY (Loo 2026-06-10) — POS-only roles reach the Backend solely
     through the Sales Order emergency hatch (Layout.tsx / posOnlyAllowedPath).
     Their sidebar shows just the Sales Orders link; every other module link
     would bounce them back to the SO create form anyway. Remove with the
     hatch. */
  const soOnly = !!staff && POS_ONLY_ROLES.has(staff.role);

  /* ── Top-level workspace links (outside Supply Chain Management) ── */
  const workspace: NavLinkRow[] = [
    { to: '/dashboard', icon: <LayoutDashboard {...ICON_PROPS} />, label: 'Dashboard' },
    ...(canSeeAuditLog
      ? [{ to: '/audit-log', icon: <FileSpreadsheet {...ICON_PROPS} />, label: 'Payment audit log' }]
      : []),
  ];

  /* ── Supply Chain Management — collapsible modules, ordered by the
        commander's importance ranking (SO → Procurement → Transport →
        Warehouse). 2026-05-28. ──

     NOTE (Phase 1b, 2026-05-28): "SO Maintenance" now lives as a button on
     the Sales Orders page (next to "New Sales Order"), and "Fabric Converter"
     is now a tab inside Products & Maintenance (next to Combo Pricing) — both
     removed from the sidebar here. */
  const supplyChain: NavSection[] = [
    {
      id: 'so',
      label: 'Sales Order',
      items: [
        { to: '/mfg-sales-orders', icon: <ClipboardList {...ICON_PROPS} />, label: 'Sales Orders' },
        { to: '/reports/sales-order-detail-listing', icon: <FileBarChart {...ICON_PROPS} />, label: 'SO Detail View' },
        // Commander 2026-05-29 — Delivery flows belong with Sales Order (the
        // outbound side), not Transportation. Drivers stays under Transportation.
        // Ordered to follow the real flow: SO → Delivery Order → Invoice → Return.
        { to: '/mfg-delivery-orders', icon: <PackagePlus {...ICON_PROPS} />, label: 'Delivery Orders' },
        { to: '/sales-invoices', icon: <FileText {...ICON_PROPS} />, label: 'Sales Invoices' },
        { to: '/delivery-returns', icon: <Undo2 {...ICON_PROPS} />, label: 'Delivery Returns' },
      ],
    },
    {
      // New top-level CONSIGNMENT group. Order / Note / Return; Purchase
      // Consignment lands here later.
      id: 'consignment',
      label: 'Consignment',
      items: [
        { to: '/consignment', icon: <Handshake {...ICON_PROPS} />, label: 'Consignment Order' },
        { to: '/consignment-note', icon: <Truck {...ICON_PROPS} />, label: 'Consignment Note' },
        { to: '/consignment-return', icon: <Undo2 {...ICON_PROPS} />, label: 'Consignment Return' },
        { to: '/purchase-consignment', icon: <ClipboardList {...ICON_PROPS} />, label: 'Purchase Consignment Order' },
        { to: '/purchase-consignment-receive', icon: <PackageCheck {...ICON_PROPS} />, label: 'Purchase Consignment Receive' },
        { to: '/purchase-consignment-return', icon: <Undo2 {...ICON_PROPS} />, label: 'Purchase Consignment Return' },
      ],
    },
    {
      id: 'procurement',
      label: 'Procurement',
      items: [
        { to: '/products', icon: <Package2 {...ICON_PROPS} />, label: 'Products & Maintenance' },
        { to: '/suppliers', icon: <Truck {...ICON_PROPS} />, label: 'Suppliers' },
        { to: '/mrp', icon: <ListTree {...ICON_PROPS} />, label: 'MRP · Stock Status' },
        { to: '/purchase-orders', icon: <ScrollText {...ICON_PROPS} />, label: 'Purchase Orders' },
        { to: '/grns', icon: <PackageCheck {...ICON_PROPS} />, label: 'Goods Receipt' },
        { to: '/purchase-invoices', icon: <Receipt {...ICON_PROPS} />, label: 'Purchase Invoices' },
        { to: '/purchase-returns', icon: <Undo2 {...ICON_PROPS} />, label: 'Purchase Returns' },
      ],
    },
    {
      id: 'transportation',
      label: 'Transportation',
      items: [
        { to: '/drivers', icon: <Truck {...ICON_PROPS} />, label: 'Drivers' },
      ],
    },
    {
      id: 'warehouse',
      label: 'Warehouse',
      items: [
        { to: '/inventory', icon: <Boxes {...ICON_PROPS} />, label: 'Inventory' },
        { to: '/inventory/adjustments', icon: <SlidersHorizontal {...ICON_PROPS} />, label: 'Adjustments' },
        { to: '/inventory/transfers', icon: <ArrowLeftRight {...ICON_PROPS} />, label: 'Transfers' },
        { to: '/inventory/stock-takes', icon: <ClipboardCheck {...ICON_PROPS} />, label: 'Stock Take' },
        // Rack/bin Warehouse view (Rack Layout · Stock In-Out · Movement
        // History) ported from Hookka ERP (Phase 3, 2026-05-28).
        { to: '/warehouse', icon: <Warehouse {...ICON_PROPS} />, label: 'Warehouse' },
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

      {soOnly ? (
        <nav className={styles.nav}>
          <div className={styles.navGroup}>Sales Order</div>
          {renderLink({
            to: '/mfg-sales-orders',
            icon: <ClipboardList {...ICON_PROPS} />,
            label: 'Sales Orders',
          })}
        </nav>
      ) : (
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

        {/* HR (gated: admin + super_admin only) */}
        {canSeeHr && (
          <>
            <div className={styles.navGroup}>HR</div>
            {renderLink({ to: '/hr/commission', icon: <Wallet {...ICON_PROPS} />, label: 'Commission' })}
            {renderLink({ to: '/hr/settings', icon: <SlidersHorizontal {...ICON_PROPS} />, label: 'HR Settings' })}
          </>
        )}

        {/* Administration (gated) */}
        {canSeeAdmin && (
          <>
            <div className={styles.navGroup}>Administration</div>
            {renderLink({ to: '/users', icon: <ShieldCheck {...ICON_PROPS} />, label: 'Users' })}
            {renderLink({ to: '/system-health', icon: <Activity {...ICON_PROPS} />, label: 'System Health' })}
          </>
        )}
      </nav>
      )}

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
