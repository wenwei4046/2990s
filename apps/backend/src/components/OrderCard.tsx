import { AlertTriangle, FileWarning, ShoppingBag } from 'lucide-react';
import { fmtMoney, fmtTime } from '@2990s/shared';
import type { OrderListRow } from '../lib/queries';
import styles from './OrderCard.module.css';

interface Props {
  order: OrderListRow;
  onOpen: (id: string) => void;
  isHighlighted?: boolean;
}

export function OrderCard({ order, onOpen, isHighlighted = false }: Props) {
  const lineCount = order.cart.reduce((sum, c) => sum + (c.qty ?? 0), 0);
  const needsPO = order.lane === 'logistics' && !order.poIssued;
  // Late: OrderListRow doesn't carry deliveryDate today, so this stays a no-op placeholder.
  // (When deliveryDate lands on the row in a future step, flip this on.)

  return (
    <button
      type="button"
      className={`${styles.card} ${isHighlighted ? styles.highlight : ''}`}
      onClick={() => onOpen(order.id)}
    >
      <div className={styles.head}>
        <span className={styles.id}>{order.id}</span>
        <span className={styles.when}>{fmtTime(order.placedAt)}</span>
      </div>

      <div>
        <div className={styles.name}>{order.customerName || 'Walk-in'}</div>
        {order.customerPhone && (
          <div className={styles.address}>
            <span>{order.customerPhone}</span>
          </div>
        )}
      </div>

      <div className={styles.lines}>
        <ShoppingBag size={12} strokeWidth={1.75} />
        <span className={styles.linesPill}>
          {lineCount} {lineCount === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.total}>
          <sup>RM</sup>
          {fmtMoney(order.total)}
        </span>
        <div className={styles.statuses}>
          {needsPO && (
            <span className={`${styles.pill} ${styles.pillWarn}`}>
              <FileWarning size={11} strokeWidth={1.75} />
              Issue PO
            </span>
          )}
        </div>
      </div>

      <div className={`${styles.row} ${styles.staffRow}`}>
        <div className={styles.staff}>
          <span>{order.paymentMethod.replace(/_/g, ' ')}</span>
        </div>
        {needsPO && (
          <div className={styles.staff}>
            <AlertTriangle size={11} strokeWidth={1.75} />
            Awaiting PO
          </div>
        )}
      </div>
    </button>
  );
}
