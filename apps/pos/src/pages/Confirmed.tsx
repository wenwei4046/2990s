import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Printer, ShoppingBag } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useOrderById } from '../lib/orders-by-id';
import { firstName } from '../lib/handover-helpers';
import { Hero } from '../components/handover/Hero';
import { OrderSummaryPane } from '../components/handover/OrderSummaryPane';
import { Topbar } from '../components/Topbar';
import type { CartLine } from '../state/cart';
import styles from './Confirmed.module.css';
import './Confirmed.print.css';

const PAYMENT_LABEL: Record<string, string> = {
  merchant: 'Merchant',
  transfer: 'Bank transfer / DuitNow',
  installment: 'Installment',
  cash: 'Cash',
};

export const Confirmed = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const { data, isLoading, error } = useOrderById(orderId);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (isLoading) return <main className={styles.shell}>Loading…</main>;
  if (error || !data) {
    return <main className={styles.shell}>Could not load order: {String(error)}</main>;
  }

  const eta = data.delivery_date
    ? new Date(data.delivery_date + 'T00:00:00').toLocaleDateString('en-MY', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
    : 'a date we will confirm soon';

  // Reshape DB lines into CartLine-shape for OrderSummaryPane reuse. Multiple
  // order_items can share a product_id (e.g. 3 sofas of the same model), so we
  // suffix the array index to keep React keys unique.
  const fakeLines: CartLine[] = data.lines.map((l, idx) => ({
    key: `${l.product_id}-${idx}`,
    qty: l.qty,
    config: {
      kind: 'flat' as const,
      productId: l.product_id,
      productName: l.product_name,
      total: Math.round(l.line_total / l.qty),
      summary: '',
    },
  }));

  return (
    <>
      <Topbar step="confirm" />
      <div className={styles.layout}>
        <div className={styles.left}>
          <Hero
            imageKey={data.dominantCategory?.hero_image_key ?? null}
            firstName={firstName(data.customer_name)}
            orderId={data.id}
            eta={eta}
            email={data.customer_email}
          />
          <div className={styles.actions}>
            <Link to="/catalog">
              <Button variant="primary">
                <ShoppingBag size={16} strokeWidth={1.75} />&nbsp;New order
              </Button>
            </Link>
            <Button variant="ghost" onClick={() => window.print()}>
              <Printer size={16} strokeWidth={1.75} />&nbsp;Print receipt
            </Button>
          </div>
        </div>
        <div className={styles.right}>
          <OrderSummaryPane
            mode="receipt"
            orderId={data.id}
            placedAt={data.placed_at}
            lines={fakeLines}
            customer={{
              name: data.customer_name,
              address: data.customer_address ?? undefined,
            }}
            delivery={{ date: data.delivery_date ? eta : undefined }}
            payment={{ method: PAYMENT_LABEL[data.payment_method] ?? data.payment_method }}
            paid={data.paid}
          />
        </div>
      </div>
    </>
  );
};
