import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useCart, cartItemCount, cartSubtotal } from '../state/cart';
import { CustomerOrderSheet } from './CustomerOrderSheet';
import styles from './CustomerOrderFab.module.css';

// Always-visible cart entry point. Shows the live subtotal so the staffer
// can glance at it during a sales conversation without opening the cart.
// Tap opens the customer-order sheet (modal overlay) — replaces the prior
// navigation to /cart so the catalog stays in context.
export function CustomerOrderFab() {
  const [open, setOpen] = useState(false);
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        onClick={() => setOpen(true)}
        aria-label={`Customer order, ${count} item${count === 1 ? '' : 's'}, ${fmtRM(subtotal)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={styles.fabIcon}>
          <ShoppingBag size={18} strokeWidth={1.75} />
        </span>
        <span className={styles.meta}>
          <span className={styles.label}>Customer order</span>
          <span className={styles.amount}>{fmtRM(subtotal)}</span>
        </span>
        {count > 0 && <span className={styles.badge}>{count}</span>}
      </button>
      <CustomerOrderSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
