// ----------------------------------------------------------------------------
// Central registry of navigable destinations — single source of truth for the
// Ctrl+K command palette AND breadcrumb labels. Keep in sync with router.tsx.
// (Commander 2026-05-29 — UI/UX reorg: "make it feel like one system".)
// ----------------------------------------------------------------------------

export type NavItem = {
  label: string;
  path: string;
  group: string;
  /** Extra search terms for the command palette (synonyms / abbreviations). */
  keywords?: string;
};

export const NAV_ITEMS: NavItem[] = [
  // Workspace
  { label: 'Dashboard', path: '/dashboard', group: 'Workspace', keywords: 'home today' },
  { label: 'Payment audit log', path: '/audit-log', group: 'Workspace', keywords: 'finance' },
  { label: 'Announcements', path: '/announcements', group: 'Workspace', keywords: 'notice memo banner broadcast sop warning learning office-wide remind' },

  // Sales Order
  { label: 'Sales Orders', path: '/mfg-sales-orders', group: 'Sales Order', keywords: 'so' },
  { label: 'New Sales Order', path: '/mfg-sales-orders/new', group: 'Sales Order', keywords: 'create so add' },
  { label: 'SO Maintenance', path: '/mfg-sales-orders/maintenance', group: 'Sales Order', keywords: 'localities warehouse dropdown' },
  // Commander 2026-05-29 — Delivery flows grouped with Sales Order (outbound side).
  // Ordered to follow the real flow: SO → Delivery Order → Invoice → Return.
  { label: 'Delivery Orders', path: '/mfg-delivery-orders', group: 'Sales Order', keywords: 'do dispatch' },
  { label: 'Sales Invoices', path: '/sales-invoices', group: 'Sales Order', keywords: 'si invoice' },
  { label: 'New Sales Invoice', path: '/sales-invoices/new', group: 'Sales Order', keywords: 'create si invoice add' },
  { label: 'Convert DO to Invoice', path: '/sales-invoices/from-do', group: 'Sales Order', keywords: 'convert delivery order sales invoice bill revenue' },
  { label: 'Delivery Returns', path: '/delivery-returns', group: 'Sales Order', keywords: 'dr return' },
  { label: 'Convert DO to Return', path: '/delivery-returns/from-do', group: 'Sales Order', keywords: 'convert do delivery return goods back' },

  // Procurement
  { label: 'Products & Maintenance', path: '/products', group: 'Procurement', keywords: 'modular combo fabric' },
  { label: 'Suppliers', path: '/suppliers', group: 'Procurement', keywords: 'vendor creditor' },
  { label: 'Currencies', path: '/currencies', group: 'Procurement', keywords: 'currency exchange rate fx myr rmb usd sgd forex' },
  { label: 'MRP · Stock Status', path: '/mrp', group: 'Procurement', keywords: 'requirements planning shortage order' },
  { label: 'Purchase Orders', path: '/purchase-orders', group: 'Procurement', keywords: 'po' },
  { label: 'New Purchase Order', path: '/purchase-orders/new', group: 'Procurement', keywords: 'create po add' },
  { label: 'Create PO from SO', path: '/purchase-orders/from-so', group: 'Procurement', keywords: 'convert post to po' },
  { label: 'Goods Receipt', path: '/grns', group: 'Procurement', keywords: 'grn receive' },
  { label: 'Purchase Invoices', path: '/purchase-invoices', group: 'Procurement', keywords: 'pi bill' },
  { label: 'Purchase Returns', path: '/purchase-returns', group: 'Procurement', keywords: 'pr return' },

  // Transportation — Delivery Planning board (Stage 4) + the consolidated
  // "Driver & Helper" / Fleet portal (Driver · Helper · Lorry masters on one
  // page, migration 0195) + the standalone Lorry Capacity dashboard.
  { label: 'Delivery Planning', path: '/delivery-planning', group: 'Transportation', keywords: 'delivery plan schedule route trip overdue pending region tms dispatch' },
  { label: 'Driver & Helper', path: '/fleet', group: 'Transportation', keywords: 'fleet driver helper lorry truck van crew loader vehicle tms outsource in-house master' },
  { label: 'Lorry Capacity', path: '/lorry-capacity', group: 'Transportation', keywords: 'lorry capacity utilisation utilization performance fleet trips revenue dashboard repair days kpi tms' },

  // Warehouse — master first (create a warehouse / set Transit here), then ops.
  { label: 'Warehouses', path: '/warehouses', group: 'Warehouse', keywords: 'create new warehouse master location transit china overseas' },
  { label: 'Inventory', path: '/inventory', group: 'Warehouse', keywords: 'stock balance' },
  { label: 'Adjustments', path: '/inventory/adjustments', group: 'Warehouse' },
  { label: 'Transfers', path: '/inventory/transfers', group: 'Warehouse' },
  { label: 'Stock Take', path: '/inventory/stock-takes', group: 'Warehouse' },
  { label: 'Racks & Bins', path: '/warehouse', group: 'Warehouse', keywords: 'rack bin shelf warehouse' },

  // Finance
  { label: 'Accounting', path: '/accounting', group: 'Finance', keywords: 'gl journal ledger' },
  { label: 'Payment Vouchers', path: '/payment-vouchers', group: 'Finance', keywords: 'pv voucher pay vendor freight cash out expense' },
  { label: 'Outstanding', path: '/outstanding', group: 'Finance', keywords: 'aging overdue' },

  // Reference
  { label: 'Customers', path: '/customers', group: 'Reference', keywords: 'debtor directory' },
  { label: 'Settings', path: '/settings', group: 'Reference' },

  // HR
  { label: 'Commission', path: '/hr/commission', group: 'HR', keywords: 'salary payroll salesperson sales commission kpi' },
  { label: 'HR Settings', path: '/hr/settings', group: 'HR', keywords: 'commission rates tier showroom item kpi payroll' },

  // Administration
  { label: 'Users', path: '/users', group: 'Administration', keywords: 'staff roles invite' },
  { label: 'System Health', path: '/system-health', group: 'Administration', keywords: 'metrics latency observability' },
];

/* Longest-prefix match → the NavItem owning a given pathname (for breadcrumbs
   on detail pages like /suppliers/:id → "Suppliers"). */
export function navItemForPath(pathname: string): NavItem | undefined {
  let best: NavItem | undefined;
  for (const it of NAV_ITEMS) {
    if (pathname === it.path || pathname.startsWith(it.path + '/')) {
      if (!best || it.path.length > best.path.length) best = it;
    }
  }
  return best;
}
