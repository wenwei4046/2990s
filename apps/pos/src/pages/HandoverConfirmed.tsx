// Thank-you screen for the POS → Backend SO handover flow (Task #70).
//
// Sister to pages/Confirmed.tsx — that page reads from the legacy retail
// `orders` table by SO-XXXX id. This one shows the just-created
// manufacturing SO docNo (SO-NNNNNN) from POST /mfg-sales-orders, before
// the coordinator has done anything with it. There's no DB row to fetch
// for the receipt summary at this point — the SO header is fresh — so the
// page shows a confirmation hero + the docNo + actions to start a new
// order or print the (forthcoming) SO PDF from the Backend portal.

import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { FileText, ShoppingBag, Ticket } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { Topbar } from '../components/Topbar';
import { usePwpCodesForSo } from '../lib/products/pwp-queries';
import styles from './Confirmed.module.css';

export const HandoverConfirmed = () => {
  const { docNo } = useParams<{ docNo: string }>();
  const pwpCodesQ = usePwpCodesForSo(docNo);
  const earnedVouchers = (pwpCodesQ.data ?? []).filter((c) => c.status === 'AVAILABLE');

  // Match the retail Confirmed page: scroll to the top on mount so the hero
  // is in view even after returning from a deep cart scroll position.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (!docNo) {
    return <main className={styles.shell}>Missing order reference.</main>;
  }

  return (
    <>
      <Topbar step="confirm" />
      <main className={styles.shell}>
        <h1>Order placed</h1>
        <p>
          Reference: <strong>{docNo}</strong>
        </p>
        <p>
          The order coordinator has been notified and will pick this up shortly.
          The customer will hear from us with delivery details soon.
        </p>

        {/* PWP vouchers earned on this order — the customer reads the code off
            the SO and the salesperson types it into "Insert PWP Code" on a
            future order. (migration 0130) */}
        {earnedVouchers.length > 0 && (
          <section style={{ margin: '0 auto', maxWidth: 420, textAlign: 'left', border: '1px solid var(--border-subtle, #e5e2dd)', borderRadius: 12, padding: 'var(--space-3)' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-16)', margin: '0 0 var(--space-2)' }}>
              <Ticket size={18} strokeWidth={1.75} /> PWP vouchers earned
            </h2>
            <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', margin: '0 0 var(--space-2)' }}>
              Redeemable on a future order via “Insert PWP Code”.
            </p>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {earnedVouchers.map((v) => (
                <li key={v.code} style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 'var(--fs-16)' }}>{v.code}</li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.actions} style={{ justifyContent: 'center' }}>
          <Link to="/catalog">
            <Button variant="primary">
              <ShoppingBag size={16} strokeWidth={1.75} />&nbsp;New order
            </Button>
          </Link>
          <Link to={`/print/sales-order/${docNo}`}>
            <Button variant="ghost">
              <FileText size={16} strokeWidth={1.75} />&nbsp;View SO / PDF
            </Button>
          </Link>
        </div>
      </main>
    </>
  );
};
