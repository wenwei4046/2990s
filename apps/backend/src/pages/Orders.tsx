import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox, RefreshCw } from 'lucide-react';
import { fmtRM, fmtTime, daysAgo } from '@2990s/shared';
import { useOrders, useOrdersRealtime, type OrderLane, type OrderListRow } from '../lib/queries';
import { OrderDrawer } from '../components/OrderDrawer';
import { PoScanModal } from '../components/PoScanModal';
import styles from './Orders.module.css';

const LANE_LABEL: Record<OrderLane, string> = {
  received:   'Received',
  proceed:    'Proceed',
  logistics:  'Logistics',
  ready:      'Ready',
  dispatched: 'Dispatched',
  delivered:  'Delivered',
  cancelled:  'Cancelled',
};

interface Toast {
  id: string;
  message: string;
}

export const Orders = () => {
  const orders = useOrders();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const openOrderId = searchParams.get('orderId');
  const [poScanOpen, setPoScanOpen] = useState(false);
  const queryClient = useQueryClient();

  // Logistics-lane orders for the Scan PO modal. Cart shape is empty
  // until catalog seeds with supplier_id-bearing products exist
  // (Task 4.1 in the Suppliers+PO sub-project). Until then the modal
  // renders the "All POs already issued" empty state — feature ships
  // dormant per spec §1.3.
  const logisticsOrdersForScan = useMemo(() => {
    const list = (orders.data ?? []).filter(
      (o) => o.lane === 'logistics' && !(o as { poIssued?: boolean }).poIssued,
    );
    return list.map((o) => ({
      id: o.id,
      customerName: o.customerName ?? '—',
      cart: [] as never[], // rollup data wiring deferred to Task 4.1
    }));
  }, [orders.data]);

  const openDrawer = (id: string) => {
    setSearchParams({ orderId: id }, { replace: true });
  };
  const closeDrawer = () => {
    setSearchParams({}, { replace: true });
  };

  const onInsert = useCallback((row: OrderListRow) => {
    setToasts((cur) => [...cur, {
      id: `t-${row.id}-${Date.now()}`,
      message: `New order ${row.id} · ${row.customerName} · ${fmtRM(row.total)}`,
    }]);
    setHighlightId(row.id);
  }, []);

  useOrdersRealtime(onInsert);

  // Toast auto-dismiss after 4s, highlight after 5s.
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((cur) => cur.slice(1)), 4000);
    return () => clearTimeout(t);
  }, [toasts]);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), 5000);
    return () => clearTimeout(t);
  }, [highlightId]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h2 className="t-h2">Orders</h2>
          <p className="t-body fg-muted">
            Realtime list of placed orders. Phase 3 turns this into the 6-lane drag-and-drop board.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {logisticsOrdersForScan.length > 0 && (
            <button
              type="button"
              onClick={() => setPoScanOpen(true)}
              style={{
                background: 'var(--c-burnt, #B87800)',
                color: 'white',
                border: 0,
                padding: '8px 14px',
                borderRadius: 'var(--radius-pill)',
                fontFamily: 'var(--font-button)',
                fontSize: 'var(--fs-13)',
                fontWeight: 'var(--w-semibold)',
                cursor: 'pointer',
              }}
            >
              Scan PO ({logisticsOrdersForScan.length})
            </button>
          )}
          <button
            type="button"
            className={styles.refresh}
            onClick={() => void orders.refetch()}
            disabled={orders.isFetching}
          >
            <RefreshCw size={14} strokeWidth={1.75} className={orders.isFetching ? styles.spinning : ''} />
            Refresh
          </button>
        </div>
      </header>

      {orders.isLoading ? (
        <p className={styles.empty}>Loading orders…</p>
      ) : orders.error ? (
        <p className={styles.empty}>Failed to load: {String(orders.error)}</p>
      ) : (orders.data?.length ?? 0) === 0 ? (
        <div className={styles.empty}>
          <Inbox size={32} strokeWidth={1.5} />
          <p>No orders yet. POS sales land here within ~300ms via Realtime.</p>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Lane</th>
              <th>Payment</th>
              <th className={styles.right}>Total</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.data!.map((o) => (
              <tr
                key={o.id}
                className={`${styles.clickable} ${highlightId === o.id ? styles.highlight : ''}`}
                onClick={() => openDrawer(o.id)}
              >
                <td className={styles.cellId}>{o.id}</td>
                <td>
                  <div className={styles.cellMain}>{o.customerName}</div>
                  {o.customerPhone && <div className={styles.cellSub}>{o.customerPhone}</div>}
                </td>
                <td><LaneBadge lane={o.lane} /></td>
                <td className={styles.cellPay}>{o.paymentMethod.replace('_', ' ')}</td>
                <td className={`${styles.right} ${styles.cellMoney}`}>{fmtRM(o.total)}</td>
                <td>
                  <div className={styles.cellMain}>{daysAgo(o.placedAt)}</div>
                  <div className={styles.cellSub}>{fmtTime(o.placedAt)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={styles.toastTray} role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={styles.toast}>{t.message}</div>)}
      </div>

      <OrderDrawer orderId={openOrderId} onClose={closeDrawer} />

      {poScanOpen && (
        <PoScanModal
          orders={logisticsOrdersForScan}
          onClose={() => setPoScanOpen(false)}
          onIssued={() => {
            void queryClient.invalidateQueries({ queryKey: ['orders'] });
          }}
        />
      )}
    </div>
  );
};

const LaneBadge = ({ lane }: { lane: OrderLane }) => (
  <span className={`${styles.lane} ${styles[`lane-${lane}`]}`}>{LANE_LABEL[lane]}</span>
);
