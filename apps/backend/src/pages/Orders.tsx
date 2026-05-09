import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Inbox, RefreshCw } from 'lucide-react';
import { fmtRM, fmtTime, daysAgo } from '@2990s/shared';
import { useOrders, useOrdersRealtime, type OrderLane, type OrderListRow } from '../lib/queries';
import { OrderDrawer } from '../components/OrderDrawer';
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
        <button
          type="button"
          className={styles.refresh}
          onClick={() => void orders.refetch()}
          disabled={orders.isFetching}
        >
          <RefreshCw size={14} strokeWidth={1.75} className={orders.isFetching ? styles.spinning : ''} />
          Refresh
        </button>
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
    </div>
  );
};

const LaneBadge = ({ lane }: { lane: OrderLane }) => (
  <span className={`${styles.lane} ${styles[`lane-${lane}`]}`}>{LANE_LABEL[lane]}</span>
);
