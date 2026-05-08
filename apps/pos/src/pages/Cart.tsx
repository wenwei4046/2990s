import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useCart, cartSubtotal, type CartLine } from '../state/cart';
import styles from './Cart.module.css';

export const Cart = () => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <IconButton
          icon={<ArrowLeft size={20} strokeWidth={1.75} />}
          aria-label="Back"
          onClick={() => navigate('/catalog')}
        />
        <h1 className={styles.heading}>Cart</h1>
      </header>

      {lines.length === 0 ? (
        <div className={styles.empty}>
          <p>Cart is empty.</p>
          <Link to="/catalog"><Button variant="primary">Browse catalog</Button></Link>
        </div>
      ) : (
        <>
          <ul className={styles.list}>
            {lines.map((l) => <Line key={l.key} line={l} onRemove={remove} onSetQty={setQty} />)}
          </ul>

          <footer className={styles.footer}>
            <div className={styles.subtotalRow}>
              <span className="t-eyebrow">Subtotal</span>
              <PriceTag amount={subtotal} size="lg" />
            </div>
            <div className={styles.actions}>
              <Button variant="ghost" onClick={clear}>Clear</Button>
              <Button variant="primary" onClick={() => navigate('/handover')}>Continue to handover</Button>
            </div>
          </footer>
        </>
      )}
    </main>
  );
};

const Line = ({ line, onRemove, onSetQty }: {
  line: CartLine;
  onRemove: (k: string) => void;
  onSetQty: (k: string, q: number) => void;
}) => (
  <li className={styles.line}>
    <div className={styles.lineMain}>
      <div className={styles.lineName}>{line.config.productName}</div>
      <div className={styles.lineSummary}>{line.config.summary}</div>
    </div>
    <div className={styles.qtyBox}>
      <button type="button" className={styles.qtyBtn} onClick={() => onSetQty(line.key, line.qty - 1)} aria-label="Decrease quantity">−</button>
      <span className={styles.qty}>{line.qty}</span>
      <button type="button" className={styles.qtyBtn} onClick={() => onSetQty(line.key, line.qty + 1)} aria-label="Increase quantity">+</button>
    </div>
    <div className={styles.lineTotal}>{fmtRM(line.qty * line.config.total)}</div>
    <IconButton
      icon={<Trash2 size={18} strokeWidth={1.75} />}
      aria-label="Remove line"
      onClick={() => onRemove(line.key)}
    />
  </li>
);
