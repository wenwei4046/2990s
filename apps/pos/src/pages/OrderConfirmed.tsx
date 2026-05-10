import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Check, ShoppingCart } from 'lucide-react';
import { Button, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { supabase } from '../lib/supabase';
import { Topbar } from '../components/Topbar';
import styles from './OrderConfirmed.module.css';

interface OrderRow {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  total: number;
  subtotal: number;
  payment_method: string;
  placed_at: string;
}

export const OrderConfirmed = () => {
  const { orderId } = useParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, customer_name, customer_phone, total, subtotal, payment_method, placed_at')
        .eq('id', orderId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      else setOrder(data as OrderRow | null);
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  return (
    <>
    <Topbar step="confirm" />
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.icon}><Check size={32} strokeWidth={2.25} /></div>
        <h1 className={styles.title}>Order placed</h1>
        <code className={styles.orderId}>{orderId}</code>

        {error && <p className={styles.error}>Could not load order details: {error}</p>}

        {order && (
          <>
            <div className={styles.row}>
              <span className="t-eyebrow">Customer</span>
              <span>{order.customer_name}{order.customer_phone ? ` · ${order.customer_phone}` : ''}</span>
            </div>
            <div className={styles.row}>
              <span className="t-eyebrow">Payment</span>
              <span>{order.payment_method.replace('_', ' ')}</span>
            </div>
            <div className={styles.row}>
              <span className="t-eyebrow">Subtotal</span>
              <span>{fmtRM(order.subtotal)}</span>
            </div>
            <div className={styles.totalRow}>
              <span className="t-eyebrow">Total</span>
              <PriceTag amount={order.total} size="lg" />
            </div>
          </>
        )}

        <div className={styles.actions}>
          <Link to="/catalog">
            <Button variant="primary">
              <ShoppingCart size={16} strokeWidth={1.75} />&nbsp;Next customer
            </Button>
          </Link>
        </div>
      </div>
    </main>
    </>
  );
};
