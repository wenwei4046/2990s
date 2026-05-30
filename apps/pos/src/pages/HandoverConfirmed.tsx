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
import { Printer, ShoppingBag } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { Topbar } from '../components/Topbar';
import styles from './Confirmed.module.css';

export const HandoverConfirmed = () => {
  const { docNo } = useParams<{ docNo: string }>();

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
        <div className={styles.actions} style={{ justifyContent: 'center' }}>
          <Link to="/catalog">
            <Button variant="primary">
              <ShoppingBag size={16} strokeWidth={1.75} />&nbsp;New order
            </Button>
          </Link>
          <Button variant="ghost" onClick={() => window.print()}>
            <Printer size={16} strokeWidth={1.75} />&nbsp;Print receipt
          </Button>
        </div>
      </main>
    </>
  );
};
