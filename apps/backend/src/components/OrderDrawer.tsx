import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fmtRM, fmtTime } from '@2990s/shared';
import { useOrderDetail, usePurchaseOrders } from '../lib/queries';
import { patchOrderLane } from '../lib/slip';
import { LaneStepper, type Lane } from './LaneStepper';
import { SlipSection } from './SlipSection';
import { DriverPickerSection } from './DriverPickerSection';
import { DispatchSection } from './DispatchSection';
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

            {order.lane === 'logistics' && (
              <PoStatusSection
                orderId={orderId}
                poIssued={order.poIssued}
                poIssuedAt={order.poIssuedAt}
              />
            )}

            {order.lane === 'ready' && (
              <DriverPickerSection
                orderId={orderId}
                driverId={order.driverId}
                confirmedDeliveryDate={order.confirmedDeliveryDate}
                confirmedWith={order.confirmedWith}
                customerExpectedDate={order.deliveryDate}
                onSaved={refresh}
              />
            )}

            {(order.lane === 'dispatched' || order.lane === 'delivered') && (
              <DispatchSection
                orderId={orderId}
                lane={order.lane as 'dispatched' | 'delivered'}
                driverId={order.driverId}
                confirmedWith={order.confirmedWith}
                dispatchedAt={order.dispatchedAt}
                deliveredAt={order.deliveredAt}
                doKey={order.doKey}
                onUpdated={refresh}
              />
            )}
          </div>
        )}
      </aside>
    </>
  );
}

function PoStatusSection({
  orderId,
  poIssued,
  poIssuedAt,
}: {
  orderId: string;
  poIssued: boolean;
  poIssuedAt: string | null;
}) {
  const pos = usePurchaseOrders(orderId);
  const firstPo = pos.data?.[0];

  const formattedDate = poIssuedAt
    ? new Date(poIssuedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : null;

  return (
    <section style={{ padding: 16, borderTop: '1px solid var(--c-line)' }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--c-ink)' }}>
        Purchase order
      </h3>
      <div style={{ marginTop: 8, fontSize: 14, color: 'var(--c-ink)' }}>
        {poIssued && firstPo
          ? <><strong>{firstPo.poNumber}</strong> · issued {formattedDate ?? '—'}</>
          : poIssued
            ? <>PO issued {formattedDate ? `on ${formattedDate}` : ''}</>
            : <span style={{ color: 'var(--fg-muted)' }}>Awaiting PO scan</span>}
      </div>
      {!poIssued && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--fg-muted)' }}>
          Open the &quot;Scan PO&quot; modal from the logistics lane to issue this order&apos;s PO.
        </div>
      )}
    </section>
  );
}
