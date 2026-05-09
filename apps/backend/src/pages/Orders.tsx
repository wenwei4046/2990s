import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useOrders, useOrdersRealtime, type OrderListRow } from '../lib/queries';
import { OrderDrawer } from '../components/OrderDrawer';
import { PoScanModal } from '../components/PoScanModal';
import { OrdersBoard } from '../components/OrdersBoard';
import styles from '../components/OrdersBoard.module.css';

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

  // Logistics-lane orders awaiting PO issuance — feed the Scan PO modal.
  const logisticsOrdersForScan = useMemo(() => {
    const list = (orders.data ?? []).filter(
      (o) => o.lane === 'logistics' && !o.poIssued,
    );
    return list.map((o) => ({
      id: o.id,
      customerName: o.customerName ?? '—',
      cart: o.cart,
    }));
  }, [orders.data]);

  const openDrawer = useCallback(
    (id: string) => {
      setSearchParams({ orderId: id }, { replace: true });
    },
    [setSearchParams],
  );
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

  const refresh = useCallback(() => {
    void orders.refetch();
  }, [orders]);

  return (
    <>
      {orders.isLoading ? (
        <div className={styles.page}>
          <p className={styles.empty}>Loading orders…</p>
        </div>
      ) : orders.error ? (
        <div className={styles.page}>
          <p className={styles.empty}>Failed to load: {String(orders.error)}</p>
        </div>
      ) : (orders.data?.length ?? 0) === 0 ? (
        <div className={styles.page}>
          <div className={styles.empty}>
            <Inbox size={32} strokeWidth={1.5} />
            <p>No orders yet. POS sales land here within ~300ms via Realtime.</p>
          </div>
        </div>
      ) : (
        <OrdersBoard
          orders={orders.data!}
          onOpenOrder={openDrawer}
          onOpenScanPo={() => setPoScanOpen(true)}
          highlightId={highlightId}
          isFetching={orders.isFetching}
          onRefresh={refresh}
        />
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
    </>
  );
};
