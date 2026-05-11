import { Link } from 'react-router';
import { ShoppingBag } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useCart, cartItemCount, cartSubtotal } from '../state/cart';
import styles from './CustomerOrderFab.module.css';

// Always-visible cart entry point. Shows the live subtotal so the staffer
// can glance at it during a sales conversation without opening the cart.
// Item-count badge appears when there's at least one line.
export function CustomerOrderFab() {
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  return (
    <Link
      to="/cart"
      className={styles.fab}
      aria-label={`Customer order, ${count} item${count === 1 ? '' : 's'}, ${fmtRM(subtotal)}`}
    >
      <span className={styles.fabIcon}>
        <ShoppingBag size={18} strokeWidth={1.75} />
      </span>
      <span className={styles.meta}>
        <span className={styles.label}>Customer order</span>
        <span className={styles.amount}>{fmtRM(subtotal)}</span>
      </span>
      {count > 0 && <span className={styles.badge}>{count}</span>}
    </Link>
  );
}
