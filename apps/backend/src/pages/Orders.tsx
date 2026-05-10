import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useOrders, useOrdersRealtime, type OrderListRow } from '../lib/queries';
import { OrderDrawer } from '../components/OrderDrawer';
import { PoScanModal } from '../components/PoScanModal';
import { OrdersBoard } from '../components/OrdersBoard';
import { useToast } from '../components/Toast';
import styles from '../components/OrdersBoard.module.css';

export const Orders = () => {
  const orders = useOrders();
  const toast = useToast();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const openOrderId = searchParams.get('orderId');
  const [poScanOpen, setPoScanOpen] = useState(false);
  const queryClient = useQueryClient();

  // Logistics-lane orders with at least one item not yet covered by a PO.
  // Cross-supplier orders flow through here once per supplier (via cart.purchased
  // on each line) until every line is purchased, at which point the API flips
  // po_issued. Filtering on `!c.purchased` instead of `!o.poIssued` is what
  // unlocks the second-supplier PO for SO-9008-shaped cross-supplier orders.
  const logisticsOrdersForScan = useMemo(() => {
    const list = (orders.data ?? []).filter(
      (o) => o.lane === 'logistics' && o.cart.some((c) => !c.purchased),
    );
    return list.map((o) => ({
      id: o.id,
      customerName: o.customerName ?? '—',
      // Only feed unpurchased items to the modal so the rollup excludes
      // already-purchased lines on the next pass.
      cart: o.cart.filter((c) => !c.purchased),
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
    toast(`New order ${row.id} · ${row.customerName} · ${fmtRM(row.total)}`);
    setHighlightId(row.id);
  }, [toast]);

  useOrdersRealtime(onInsert);

  // Highlight fades after 5s.
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
