import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fmtRM, fmtTime } from '@2990s/shared';
import { useOrderDetail } from '../lib/queries';
import { patchOrderLane } from '../lib/slip';
import { LaneStepper, type Lane } from './LaneStepper';
import { SlipSection } from './SlipSection';
import styles from './OrderDrawer.module.css';

interface Props {
  orderId: string | null;
  onClose: () => void;
}

export function OrderDrawer({ orderId, onClose }: Props) {
  const qc = useQueryClient();
  const { data: order, isLoading, error } = useOrderDetail(orderId);

  // Esc to close
  useEffect(() => {
    if (!orderId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderId, onClose]);

  if (!orderId) return null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['order', orderId] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  };

  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden />
      <aside className={styles.drawer} role="dialog" aria-label={`Order ${orderId}`}>
        <header className={styles.head}>
          <div>
            <div className={styles.id}>{orderId}</div>
            <div className={styles.sub}>{order?.customerName ?? '...'}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.close}>×</button>
        </header>

        {isLoading && <div className={styles.body}>Loading...</div>}
        {error && <div className={styles.body}><p className={styles.errorMsg}>Failed to load: {String(error)}</p></div>}

        {order && (
          <div className={styles.body}>
            <LaneStepper
              current={order.lane as Lane}
              onAdvance={async (next) => {
                try {
                  await patchOrderLane(orderId, next);
                  refresh();
                } catch (err) {
                  alert(err instanceof Error ? err.message : 'Lane update failed');
                }
              }}
            />

            <section className={styles.info}>
              <div><b>Phone</b><span>{order.customerPhone ?? '—'}</span></div>
              <div><b>Email</b><span>{order.customerEmail ?? '—'}</span></div>
              <div><b>Total</b><span>{fmtRM(order.total)}</span></div>
              <div><b>Paid</b><span>{fmtRM(order.paid)}</span></div>
              <div><b>Payment</b><span>{order.paymentMethod}</span></div>
              <div><b>Placed</b><span>{fmtTime(order.placedAt)}</span></div>
              {order.customerAddress && (
                <div className={styles.addressRow}>
                  <b>Address</b>
                  <span>
                    {order.customerAddress}
                    {order.customerPostcode || order.customerCity || order.customerState
                      ? ` · ${[order.customerPostcode, order.customerCity, order.customerState].filter(Boolean).join(' ')}`
                      : ''}
                  </span>
                </div>
              )}
              {order.notes && (
                <div className={styles.addressRow}>
                  <b>Notes</b><span>{order.notes}</span>
                </div>
              )}
            </section>

            <SlipSection
              orderId={orderId}
              slipKey={order.slipKey}
              slipState={order.slipState}
              slipVerifiedBy={order.slipVerifiedBy}
              slipVerifiedAt={order.slipVerifiedAt}
              slipFlagReason={order.slipFlagReason}
              onUpdated={refresh}
            />
          </div>
        )}
      </aside>
    </>
  );
}
