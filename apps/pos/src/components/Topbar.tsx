import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Bookmark, ListOrdered, LogOut, ShoppingBag } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useAuth } from '../lib/auth';
import { useStaff } from '../lib/staff';
import { useCart, cartItemCount, cartSubtotal } from '../state/cart';
import styles from './Topbar.module.css';

export type StepId = 'cart' | 'customer' | 'confirm';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'cart', label: 'Cart' },
  { id: 'customer', label: 'Customer' },
  { id: 'confirm', label: 'Confirmed' },
];

interface TopbarProps {
  step?: StepId;
  /**
   * When provided, replaces the default Quotes / My orders / Cart pills
   * (used by Configurator to inject product info + LIVE TOTAL + Cancel +
   * Add to Cart). Avatar + logout still render after the slot.
   */
  rightSlot?: ReactNode;
  /**
   * When provided, replaces the CART / CUSTOMER / CONFIRMED step pills in
   * the topbar's center area. Used by Configurator to inject back arrow,
   * depth toggle, and mode tabs — step pills don't make sense while staff
   * is mid-build of a single SKU.
   */
  centerSlot?: ReactNode;
}

export function Topbar({ step, rightSlot, centerSlot }: TopbarProps) {
  const { user, signOut } = useAuth();
  const { data: staff } = useStaff();
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  // Display name fallbacks: staff → email local part → "Staff".
  const initials = staff?.initials ?? user?.email?.slice(0, 2).toUpperCase() ?? '··';
  const name = staff?.name ?? user?.email?.split('@')[0] ?? 'Staff';
  const role = staff?.role ?? 'Staff';
  const avatarColor = staff?.color ?? '#A6471E';

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <Link to="/catalog" className={styles.wordmark} aria-label="2990's POS home">
          2990
          <span className={styles.wordmarkRing}>S</span>
        </Link>
        <span className={styles.crumb}>POS · Showroom KL</span>
      </div>

      <div className={styles.center}>
        {centerSlot ?? STEPS.map((s, i) => (
          <span
            key={s.id}
            className={`${styles.step} ${step === s.id ? styles.stepActive : ''}`}
          >
            <span className={styles.stepIdx}>0{i + 1}</span>
            {s.label}
          </span>
        ))}
      </div>

      <div className={styles.right}>
        {rightSlot ?? (
          <>
            <Link to="/quotes" className={styles.pill} aria-label="Saved quotes">
              <Bookmark size={13} strokeWidth={1.75} />
              <span>Quotes</span>
            </Link>
            <Link to="/my-orders" className={styles.pill} aria-label="My orders">
              <ListOrdered size={13} strokeWidth={1.75} />
              <span>My orders</span>
            </Link>
            {count > 0 && (
              <Link to="/cart" className={styles.cartChip} aria-label="Cart">
                <ShoppingBag size={13} strokeWidth={1.75} />
                {count} item{count > 1 ? 's' : ''} · {fmtRM(subtotal)}
              </Link>
            )}
          </>
        )}
        {user && (
          <span className={styles.staffChip}>
            <span className={styles.avatar} style={{ background: avatarColor }}>
              {initials}
            </span>
            <span className={styles.staffMeta}>
              <span>{name}</span>
              <span className={styles.staffRole}>{role.replace(/_/g, ' ')}</span>
            </span>
          </span>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void signOut()}
          aria-label="Sign out"
        >
          <LogOut size={18} strokeWidth={1.75} />
        </button>
      </div>
    </header>
  );
}
