import { useNavigate } from 'react-router';
import { useCart, cartItemCount } from '../state/cart';
import { CartContents } from './CartContents';
import styles from './CartRail.module.css';

export const CartRail = () => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);

  return (
    <aside className={styles.rail} aria-label="Cart">
      <header className={styles.header}>
        <span className={styles.headerTitle}>Cart</span>
        {count > 0 && <span className={styles.headerCount}>{count}</span>}
      </header>
      <div className={styles.body}>
        <CartContents variant="rail" onContinue={() => navigate('/handover')} />
      </div>
    </aside>
  );
};
