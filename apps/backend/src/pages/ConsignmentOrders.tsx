// ----------------------------------------------------------------------------
// ConsignmentOrders — Consignment Order list at /consignment.
//
// Clone of the SO list, kept simple: a table of consignment orders (Doc No,
// Debtor, Date, Status, Total) + a "New Consignment Order" button + a search
// box; a row click opens the detail page. Uses the SAME card / table look as
// the SO Detail / list pages (SalesOrderDetail.module.css) so it matches the
// rest of the app.
//
// Backend: GET /consignment-orders → { salesOrders: [...] } (mirrors the SO
// list shape; numbering is CS-YYMM-NNN).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import { useConsignmentOrders } from '../lib/consignment-order-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

type ConsignmentRow = {
  doc_no: string;
  so_date: string;
  debtor_code: string | null;
  debtor_name: string;
  phone: string | null;
  customer_so_no: string | null;
  status: string;
  currency: string;
  local_total_centi: number;
};

const STATUS_CLASS: Record<string, string> = {
  CONFIRMED:      styles.statusConfirmed ?? '',
  IN_PRODUCTION:  styles.statusInProd ?? '',
  READY_TO_SHIP:  styles.statusReady ?? '',
  SHIPPED:        styles.statusShipped ?? '',
  DELIVERED:      styles.statusDelivered ?? '',
  INVOICED:       styles.statusInvoiced ?? '',
  CLOSED:         styles.statusClosed ?? '',
  CANCELLED:      styles.statusCancelled ?? '',
  RETURNED:       styles.statusReturned ?? '',
};

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const ConsignmentOrders = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useConsignmentOrders();
  const allRows = useMemo<ConsignmentRow[]>(
    () => (data?.salesOrders ?? []) as ConsignmentRow[],
    [data],
  );
  const [search, setSearch] = useState('');

  const rows = useMemo<ConsignmentRow[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => {
      const blob = [r.doc_no, r.debtor_name, r.debtor_code, r.customer_so_no, r.phone]
        .filter(Boolean).join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [allRows, search]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Consignment Orders</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="md" onClick={() => navigate('/consignment/new')}>
            <Plus {...ICON} />
            <span>New Consignment Order</span>
          </Button>
        </div>
      </div>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>
            {isLoading ? 'Loading…' : `${rows.length} of ${allRows.length} orders`}
          </h2>
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={14} strokeWidth={1.75}
              style={{ position: 'absolute', left: 10, color: 'var(--fg-muted)', pointerEvents: 'none' }} />
            <input
              className={styles.fieldInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Doc No, customer, reference…"
              style={{ paddingLeft: 30, minWidth: 260 }}
            />
          </span>
        </header>

        {rows.length === 0 && !isLoading ? (
          <p className={styles.emptyRow}>
            No consignment orders yet — click "New Consignment Order" to start.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Doc No</th>
                <th>Debtor</th>
                <th>Date</th>
                <th>Status</th>
                <th className={styles.tableRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.doc_no}
                  onClick={() => navigate(`/consignment/${r.doc_no}`)}
                  style={{
                    cursor: 'pointer',
                    ...(r.status === 'CANCELLED'
                      ? { opacity: 0.55, filter: 'grayscale(0.6)' }
                      : null),
                  }}
                >
                  <td>
                    <span className={styles.codeCell} style={{ color: 'var(--c-burnt)', fontWeight: 700 }}>
                      {r.doc_no}
                    </span>
                  </td>
                  <td>
                    <div>{r.debtor_name}</div>
                    {r.debtor_code && <div className={styles.muted}>{r.debtor_code}</div>}
                  </td>
                  <td>{fmtDateOrDash(r.so_date)}</td>
                  <td>
                    <span className={`${styles.statusPill} ${STATUS_CLASS[r.status] ?? ''}`}>
                      {(r.status ?? '').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className={styles.priceCell}>{fmtRm(r.local_total_centi, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
