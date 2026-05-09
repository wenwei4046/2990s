import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FileText } from 'lucide-react';
import { fmtRM, fmtTime } from '@2990s/shared';
import { useOrderDetail, usePurchaseOrders } from '../lib/queries';
import { LANES } from '../lib/lanes';
import { patchOrderLane } from '../lib/slip';
import { LaneStepper, type Lane } from './LaneStepper';
import { SlipSection } from './SlipSection';
import { DriverPickerSection } from './DriverPickerSection';
import { DispatchSection } from './DispatchSection';
import { useToast } from './Toast';
import styles from './OrderDrawer.module.css';

interface Props {
  orderId: string | null;
  onClose: () => void;
}

const LANE_LABEL: Record<Lane, string> = {
  received: 'Received',
  proceed: 'Proceed',
  logistics: 'Logistics',
  ready: 'Ready',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
};

export function OrderDrawer({ orderId, onClose }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: order, isLoading, error } = useOrderDetail(orderId);

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

  const advance = async (next: Lane) => {
    try {
      await patchOrderLane(orderId, next);
      toast(`${orderId} → ${LANE_LABEL[next]}`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lane update failed');
    }
  };

  const stepBack = async () => {
    if (!order) return;
    const idx = LANES.findIndex((l) => l.id === order.lane);
    if (idx <= 0) return;
    const prev = LANES[idx - 1]!.id;
    await advance(prev as Lane);
  };

  const generatePdf = () => {
    if (!order) return;
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) {
      toast('Pop-up blocked — allow pop-ups for receipts');
      return;
    }
    const placedFmt = new Date(order.placedAt).toLocaleString('en-MY', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const addressBits = [
      order.customerAddress,
      [order.customerPostcode, order.customerCity, order.customerState].filter(Boolean).join(' '),
    ].filter(Boolean).join(' · ');
    const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>${order.id} · 2990's order receipt</title>
<style>
  @page { size: A4; margin: 24mm; }
  body {
    font-family: 'Poppins', system-ui, sans-serif;
    color: #221F20;
    background: #FFF9EB;
    margin: 0;
    padding: 32px;
  }
  .head { border-bottom: 1px solid rgba(34,31,32,0.15); padding-bottom: 16px; margin-bottom: 24px; }
  .brand { font-family: 'Archivo Black', system-ui, sans-serif; font-size: 24px; color: #A6471E; letter-spacing: -0.02em; }
  h1 { font-family: 'Merriweather', Georgia, serif; font-size: 28px; margin: 8px 0 4px; }
  .id { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 14px; color: #5C5455; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  td { padding: 10px 0; border-bottom: 1px solid rgba(34,31,32,0.08); font-size: 14px; vertical-align: top; }
  td.label { color: #5C5455; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; width: 30%; }
  .total { font-family: 'Archivo Black', sans-serif; font-size: 28px; color: #A6471E; }
  .lane-pill {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 999px;
    background: rgba(232,107,58,0.15);
    color: #A6471E;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .foot { margin-top: 32px; font-size: 11px; color: #8B7E6A; text-align: center; }
</style>
</head><body>
  <div class="head">
    <div class="brand">2990<sup style="font-size:14px">®</sup></div>
    <h1>Order receipt</h1>
    <div class="id">${order.id} · placed ${placedFmt}</div>
  </div>
  <table>
    <tr><td class="label">Customer</td><td>${escapeHtml(order.customerName)}</td></tr>
    <tr><td class="label">Phone</td><td>${escapeHtml(order.customerPhone ?? '—')}</td></tr>
    ${order.customerEmail ? `<tr><td class="label">Email</td><td>${escapeHtml(order.customerEmail)}</td></tr>` : ''}
    ${addressBits ? `<tr><td class="label">Address</td><td>${escapeHtml(addressBits)}</td></tr>` : ''}
    <tr><td class="label">Payment</td><td>${escapeHtml(order.paymentMethod)}</td></tr>
    ${order.approvalCode ? `<tr><td class="label">Approval</td><td>${escapeHtml(order.approvalCode)}</td></tr>` : ''}
    <tr><td class="label">Lane</td><td><span class="lane-pill">${LANE_LABEL[order.lane as Lane]}</span></td></tr>
    <tr><td class="label">Subtotal</td><td>RM ${order.subtotal.toLocaleString('en-MY')}</td></tr>
    ${order.addonTotal > 0 ? `<tr><td class="label">Add-ons</td><td>RM ${order.addonTotal.toLocaleString('en-MY')}</td></tr>` : ''}
    <tr><td class="label">Total</td><td><span class="total">RM ${order.total.toLocaleString('en-MY')}</span></td></tr>
    <tr><td class="label">Paid</td><td>RM ${order.paid.toLocaleString('en-MY')}</td></tr>
    ${order.notes ? `<tr><td class="label">Notes</td><td>${escapeHtml(order.notes)}</td></tr>` : ''}
  </table>
  <div class="foot">
    Same price. Every piece. Always. — 2990's<br />
    Generated ${new Date().toLocaleString('en-MY')}
  </div>
  <script>setTimeout(function() { window.print(); }, 200);</script>
</body></html>`;
    w.document.write(html);
    w.document.close();
  };

  const canStepBack =
    order && order.lane !== 'received' && order.lane !== 'delivered';

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
          <>
            <div className={styles.body}>
              <LaneStepper
                current={order.lane as Lane}
                poIssued={order.poIssued}
                onAdvance={advance}
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

            <footer className={styles.footer}>
              <button type="button" className={styles.footerBtn} onClick={generatePdf}>
                <FileText size={14} strokeWidth={1.75} />
                Generate PDF
              </button>
              {canStepBack && (
                <button
                  type="button"
                  className={`${styles.footerBtn} ${styles.footerBtnGhost}`}
                  onClick={stepBack}
                >
                  <ChevronLeft size={14} strokeWidth={1.75} />
                  Step back
                </button>
              )}
            </footer>
          </>
        )}
      </aside>
    </>
  );
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c),
  );

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
    <section className={styles.poSection}>
      <h3 className={styles.poHeading}>Purchase order</h3>
      <div className={styles.poBody}>
        {poIssued && firstPo
          ? <><strong>{firstPo.poNumber}</strong> · issued {formattedDate ?? '—'}</>
          : poIssued
            ? <>PO issued {formattedDate ? `on ${formattedDate}` : ''}</>
            : <span className={styles.poMuted}>Awaiting PO scan</span>}
      </div>
      {!poIssued && (
        <div className={styles.poHint}>
          Open the &quot;Scan PO&quot; modal from the logistics lane to issue this order&apos;s PO.
        </div>
      )}
    </section>
  );
}
