import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Search, Users } from 'lucide-react';
import { fmtDate, fmtRM, daysAgo, formatPhone } from '@2990s/shared';
import { useMfgSalesOrders } from '../lib/flow-queries';
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

export const Customers = () => {
  const salesOrders = useMfgSalesOrders(undefined);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const customers = useMemo(
    () => aggregate((salesOrders.data?.salesOrders ?? []) as SoRow[]),
    [salesOrders.data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const phoneMatch = (c.phone ?? '').toLowerCase().includes(q);
      return nameMatch || phoneMatch;
    });
  }, [customers, query]);

  const toggleExpand = (key: string) => {
    setExpanded((cur) => (cur === key ? null : key));
  };

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

      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={14} strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            placeholder="Search by phone or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search customers"
          />
        </label>
        <span className={styles.totalsCount}>
          {filtered.length} {filtered.length === 1 ? 'customer' : 'customers'}
          {query && customers.length !== filtered.length && (
            <> · {customers.length} total</>
          )}
        </span>
      </div>

      <div className={styles.tableCard}>
        {salesOrders.isLoading ? (
          <div className={styles.empty}>Loading customers…</div>
        ) : salesOrders.error ? (
          <div className={styles.empty}>Failed to load: {String(salesOrders.error)}</div>
        ) : customers.length === 0 ? (
          <div className={styles.empty}>
            <Users size={28} strokeWidth={1.5} aria-hidden />
            <p>No customers yet. Each Sales Order adds an entry here.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <p>No matches for "{query}".</p>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th className={styles.numericCol}>Orders</th>
                <th className={styles.numericCol}>Lifetime value</th>
                <th>Last order</th>
                <th aria-label="Expand" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const isOpen = expanded === c.key;
                return (
                  <CustomerRow
                    key={c.key}
                    customer={c}
                    isOpen={isOpen}
                    onToggle={() => toggleExpand(c.key)}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

interface CustomerRowProps {
  customer: CustomerEntry;
  isOpen: boolean;
  onToggle: () => void;
}

const CustomerRow = ({ customer, isOpen, onToggle }: CustomerRowProps) => {
  const onKey = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <>
      <tr
        className={`${styles.summaryRow} ${isOpen ? styles.expanded : ''}`}
        onClick={onToggle}
        onKeyDown={onKey}
        tabIndex={0}
        role="button"
        aria-expanded={isOpen}
        aria-label={`${isOpen ? 'Collapse' : 'Expand'} order history for ${customer.name}`}
      >
        <td>
          <div className={styles.nameCell}>
            <span className={styles.nameMain}>{customer.name}</span>
          </div>
        </td>
        <td>
          {customer.phone
            ? <span className={styles.phone}>{formatPhone(customer.phone)}</span>
            : <span className={styles.phoneEmpty}>—</span>}
        </td>
        <td className={styles.numericCol}>
          <span className={styles.countPill}>{customer.orderCount}</span>
        </td>
        <td className={styles.numericCol}>
          <span className={styles.lifetime}>{fmtRM(customer.lifetimeValue)}</span>
        </td>
        <td>
          <span className={styles.lastSeen}>
            {fmtDate(customer.lastOrderAt)} · {daysAgo(customer.lastOrderAt)}
          </span>
        </td>
        <td className={styles.chevronCell}>
          <ChevronRight
            size={16}
            strokeWidth={1.75}
            className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
            aria-hidden
          />
        </td>
      </tr>

      {isOpen && (
        <tr className={styles.historyRow}>
          <td colSpan={6}>
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
          </td>
        </tr>
      )}
    </>
  );
};
