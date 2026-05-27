import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Search, Users } from 'lucide-react';
import { fmtDate, fmtRM, daysAgo, formatPhone } from '@2990s/shared';
import { useOrders, type OrderLane, type OrderListRow } from '../lib/queries';
import styles from './Customers.module.css';

/* ─── Aggregation ────────────────────────────────────────────────────────
 * No dedicated `customers` table is wired yet — orders carry denormalized
 * customer_* columns. So "customers directory" = GROUP BY phone over orders.
 *
 * Key choice: phone if present, else lowercased name. This mirrors how the
 * POS will eventually upsert the customers table once that path lights up.
 * Fine at MVP volume (<100 orders); swap for a Postgres VIEW if it gets hot.
 * ─────────────────────────────────────────────────────────────────────── */

interface CustomerEntry {
  key: string;
  name: string;
  phone: string | null;
  orderCount: number;
  lifetimeValue: number;
  lastOrderAt: string;       // ISO of most recent order
  orders: OrderListRow[];    // sorted desc by placedAt
}

const aggregate = (orders: OrderListRow[]): CustomerEntry[] => {
  const map = new Map<string, CustomerEntry>();

  for (const o of orders) {
    if (o.lane === 'cancelled') continue; // Cancelled orders don't count toward LTV
    const key = o.customerPhone?.trim() || `name:${(o.customerName ?? '').toLowerCase().trim()}`;
    if (!key || key === 'name:') continue;

    const existing = map.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.lifetimeValue += o.total;
      existing.orders.push(o);
      // Pick most-recent name + phone, since denormalised snapshots can drift
      if (o.placedAt > existing.lastOrderAt) {
        existing.lastOrderAt = o.placedAt;
        existing.name = o.customerName || existing.name;
        existing.phone = o.customerPhone ?? existing.phone;
      }
    } else {
      map.set(key, {
        key,
        name: o.customerName || 'Walk-in',
        phone: o.customerPhone ?? null,
        orderCount: 1,
        lifetimeValue: o.total,
        lastOrderAt: o.placedAt,
        orders: [o],
      });
    }
  }

  // Sort each customer's order list desc by date, then sort customers by recency
  const list = Array.from(map.values());
  for (const c of list) {
    c.orders.sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1));
  }
  list.sort((a, b) => (a.lastOrderAt < b.lastOrderAt ? 1 : -1));
  return list;
};

const laneLabel = (lane: OrderLane): string => {
  switch (lane) {
    case 'received':   return 'Received';
    case 'proceed':    return 'Proceed';
    case 'logistics':  return 'Logistics';
    case 'ready':      return 'Ready';
    case 'dispatched': return 'Dispatched';
    case 'delivered':  return 'Delivered';
    case 'cancelled':  return 'Cancelled';
  }
};
const laneClass = (lane: OrderLane): string => {
  switch (lane) {
    case 'received':   return styles.laneReceived ?? '';
    case 'proceed':    return styles.laneProceed ?? '';
    case 'logistics':  return styles.laneLogistics ?? '';
    case 'ready':      return styles.laneReady ?? '';
    case 'dispatched': return styles.laneDispatched ?? '';
    case 'delivered':  return styles.laneDelivered ?? '';
    case 'cancelled':  return styles.laneCancelled ?? '';
  }
};

export const Customers = () => {
  const orders = useOrders();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const customers = useMemo(
    () => aggregate(orders.data ?? []),
    [orders.data],
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
            Read-only directory aggregated from order history. Search by phone or name to look up
            a customer, then expand to see every order they've placed. New entries appear here
            automatically when POS confirms an order.
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
        {orders.isLoading ? (
          <div className={styles.empty}>Loading customers…</div>
        ) : orders.error ? (
          <div className={styles.empty}>Failed to load: {String(orders.error)}</div>
        ) : customers.length === 0 ? (
          <div className={styles.empty}>
            <Users size={28} strokeWidth={1.5} aria-hidden />
            <p>No customers yet. Each confirmed POS order adds an entry here.</p>
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
                    <th>Lane</th>
                    <th>Items</th>
                    <th className={styles.numericCol}>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customer.orders.map((o) => {
                    const lineCount = o.cart.reduce(
                      (sum, item) => sum + (item.qty ?? 0),
                      0,
                    );
                    return (
                      <tr key={o.id}>
                        <td>
                          <span className={styles.orderId}>{o.id}</span>
                        </td>
                        <td>{fmtDate(o.placedAt)}</td>
                        <td>
                          <span className={`${styles.lanePill} ${laneClass(o.lane)}`}>
                            {laneLabel(o.lane)}
                          </span>
                        </td>
                        <td>
                          {lineCount} {lineCount === 1 ? 'item' : 'items'}
                        </td>
                        <td className={styles.numericCol}>{fmtRM(o.total)}</td>
                        <td className={styles.numericCol}>
                          <Link
                            to={`/orders?orderId=${o.id}`}
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
