import { useMemo } from 'react';
import { Link } from 'react-router';
import { fmtDate, fmtRM, daysAgo, formatPhone } from '@2990s/shared';
import { useMfgSalesOrders } from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './Customers.module.css';

/* ─── Aggregation ────────────────────────────────────────────────────────
 * Phase C2 — the directory now aggregates Sales Orders (mfg_sales_orders)
 * instead of the legacy retail `orders` table. No dedicated `customers`
 * table is wired yet — SOs carry denormalized debtor_name / phone columns,
 * so "customers directory" = GROUP BY phone over Sales Orders.
 *
 * Key choice: phone if present, else lowercased debtor name. Fine at MVP
 * volume; swap for a Postgres VIEW if it gets hot.
 *
 * SO totals are stored in centi — divide by 100 before display / LTV.
 * CANCELLED and ON_HOLD SOs are excluded from lifetime value + aggregation.
 * ─────────────────────────────────────────────────────────────────────── */

/* Minimal SO list row (full row typed in MfgSalesOrdersList). */
interface SoRow {
  doc_no: string;
  status: string;
  debtor_name: string | null;
  phone: string | null;
  local_total_centi: number;
  created_at: string | null;
  so_date: string | null;
  line_count?: number | null;
}

interface CustomerEntry {
  key: string;
  name: string;
  phone: string | null;
  orderCount: number;
  lifetimeValue: number;       // MYR (centi already converted)
  lastOrderAt: string;         // ISO/date of most recent order
  orders: SoRow[];             // sorted desc by date
}

/* SO date for recency — created_at (timestamp) when present, else so_date. */
const soDateOf = (o: SoRow): string => o.created_at ?? o.so_date ?? '';

const aggregate = (orders: SoRow[]): CustomerEntry[] => {
  const map = new Map<string, CustomerEntry>();

  for (const o of orders) {
    // CANCELLED + ON_HOLD don't count toward LTV / the directory.
    if (o.status === 'CANCELLED' || o.status === 'ON_HOLD') continue;
    const key = o.phone?.trim() || `name:${(o.debtor_name ?? '').toLowerCase().trim()}`;
    if (!key || key === 'name:') continue;

    const totalMyr = (o.local_total_centi ?? 0) / 100;
    const when = soDateOf(o);

    const existing = map.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.lifetimeValue += totalMyr;
      existing.orders.push(o);
      // Pick most-recent name + phone, since denormalised snapshots can drift
      if (when > existing.lastOrderAt) {
        existing.lastOrderAt = when;
        existing.name = o.debtor_name || existing.name;
        existing.phone = o.phone ?? existing.phone;
      }
    } else {
      map.set(key, {
        key,
        name: o.debtor_name || 'Walk-in',
        phone: o.phone ?? null,
        orderCount: 1,
        lifetimeValue: totalMyr,
        lastOrderAt: when,
        orders: [o],
      });
    }
  }

  // Sort each customer's order list desc by date, then sort customers by recency
  const list = Array.from(map.values());
  for (const c of list) {
    c.orders.sort((a, b) => (soDateOf(a) < soDateOf(b) ? 1 : -1));
  }
  list.sort((a, b) => (a.lastOrderAt < b.lastOrderAt ? 1 : -1));
  return list;
};

/* SO status → short label. Mirrors the SO module's vocabulary
   (MfgSalesOrdersList STATUS_LABEL) so the directory reads the same as the
   Sales Orders ledger. */
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED:     'Confirmed',
  IN_PRODUCTION: 'Proceed',
  READY_TO_SHIP: 'Stock Ready',
  SHIPPED:       'Arranged',
  DELIVERED:     'Delivered',
  INVOICED:      'Invoiced',
  CLOSED:        'Closed',
  ON_HOLD:       'On Hold',
  CANCELLED:     'Cancelled',
};
const statusLabel = (status: string): string =>
  STATUS_LABEL[status] ?? status.replace(/_/g, ' ');

/* ── DataGrid columns (shared-grid conversion 2026-06-12) ────────────────
   Static spec — module scope keeps the reference stable so DataGrid's memo
   hits. Row click expands the order history inline (same behaviour as the
   old expandable <tr>), via the grid's `expandable` chevron column. */
const CUSTOMER_COLUMNS: DataGridColumn<CustomerEntry>[] = [
  {
    key: 'name',
    label: 'Customer',
    width: 220,
    accessor: (c) => <span className={styles.nameMain}>{c.name}</span>,
    searchValue: (c) => c.name,
    filterValue: (c) => c.name,
    sortFn: (a, b) => a.name.localeCompare(b.name),
  },
  {
    key: 'phone',
    label: 'Phone',
    width: 150,
    accessor: (c) => c.phone
      ? <span className={styles.phone}>{formatPhone(c.phone)}</span>
      : <span className={styles.phoneEmpty}>—</span>,
    // Raw + formatted so "0123456789" and "+60 12-345 6789" both match.
    searchValue: (c) => c.phone ? `${c.phone} ${formatPhone(c.phone)}` : '',
    filterValue: (c) => c.phone ? formatPhone(c.phone) : '—',
  },
  {
    key: 'orders',
    label: 'Orders',
    width: 90,
    align: 'right',
    accessor: (c) => <span className={styles.countPill}>{c.orderCount}</span>,
    searchValue: () => '',
    filterValue: (c) => String(c.orderCount),
    sortFn: (a, b) => a.orderCount - b.orderCount,
  },
  {
    key: 'ltv',
    label: 'Lifetime value',
    width: 140,
    align: 'right',
    accessor: (c) => <span className={styles.lifetime}>{fmtRM(c.lifetimeValue)}</span>,
    searchValue: () => '',
    filterValue: (c) => fmtRM(c.lifetimeValue),
    sortFn: (a, b) => a.lifetimeValue - b.lifetimeValue,
  },
  {
    key: 'last',
    label: 'Last order',
    width: 190,
    accessor: (c) => (
      <span className={styles.lastSeen}>
        {fmtDate(c.lastOrderAt)} · {daysAgo(c.lastOrderAt)}
      </span>
    ),
    searchValue: (c) => fmtDate(c.lastOrderAt),
    filterValue: (c) => fmtDate(c.lastOrderAt),
    sortFn: (a, b) => a.lastOrderAt.localeCompare(b.lastOrderAt),
    filterType: 'date', dateValue: (c) => c.lastOrderAt,
  },
];

export const Customers = () => {
  const salesOrders = useMfgSalesOrders(undefined);

  const customers = useMemo(
    () => aggregate((salesOrders.data?.salesOrders ?? []) as SoRow[]),
    [salesOrders.data],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className="t-eyebrow">Directory · grouped by phone</div>
          <h2 className={styles.title}>Customers</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Read-only directory aggregated from Sales Order history. Search by phone or name to look up
            a customer, then expand to see every order they've placed. New entries appear here
            automatically when a Sales Order is created.
          </p>
        </div>
      </header>

      {salesOrders.error ? (
        <div className={styles.tableCard}>
          <div className={styles.empty}>Failed to load: {String(salesOrders.error)}</div>
        </div>
      ) : (
        <DataGrid
          rows={customers}
          columns={CUSTOMER_COLUMNS}
          storageKey="dg-customers"
          rowKey={(c) => c.key}
          searchPlaceholder="Search by phone or name…"
          groupBanner={false}
          isLoading={salesOrders.isLoading}
          emptyMessage="No customers yet. Each Sales Order adds an entry here."
          expandable={{ renderExpansion: (c) => <CustomerHistory customer={c} /> }}
          toolbar={
            <span className={styles.totalsCount}>
              {customers.length} {customers.length === 1 ? 'customer' : 'customers'}
            </span>
          }
        />
      )}
    </div>
  );
};

/* Inline order-history panel rendered by the grid's expansion row. Same
   markup as the legacy expandable <tr> body. */
const CustomerHistory = ({ customer }: { customer: CustomerEntry }) => (
  <div className={styles.history}>
    <div className={styles.historyHeading}>
      Order history · {customer.orderCount}{' '}
      {customer.orderCount === 1 ? 'order' : 'orders'}
    </div>
    <table className={styles.historyTable}>
      <thead>
        <tr>
          <th>Order</th>
          <th>Placed</th>
          <th>Status</th>
          <th>Items</th>
          <th className={styles.numericCol}>Total</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {customer.orders.map((o) => {
          const lineCount = o.line_count ?? 0;
          return (
            <tr key={o.doc_no}>
              <td>
                <span className={styles.orderId}>{o.doc_no}</span>
              </td>
              <td>{fmtDate(soDateOf(o))}</td>
              <td>
                <span className={styles.lanePill}>
                  {statusLabel(o.status)}
                </span>
              </td>
              <td>
                {lineCount} {lineCount === 1 ? 'item' : 'items'}
              </td>
              <td className={styles.numericCol}>{fmtRM((o.local_total_centi ?? 0) / 100)}</td>
              <td className={styles.numericCol}>
                <Link
                  to={`/mfg-sales-orders/${o.doc_no}`}
                  className={styles.openLink}
                  onClick={(e) => e.stopPropagation()}
                >
                  Open
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);
