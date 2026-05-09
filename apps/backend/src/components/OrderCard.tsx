import {
  AlertTriangle,
  FileWarning,
  ShieldCheck,
  ShieldAlert,
  Clock,
  MapPin,
  Calendar,
} from 'lucide-react';
import { fmtMoney, fmtTime } from '@2990s/shared';
import type { OrderListRow } from '../lib/queries';
import styles from './OrderCard.module.css';

interface Props {
  order: OrderListRow;
  onOpen: (id: string) => void;
  isHighlighted?: boolean;
}

const fmtShortDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });
};

const productInitial = (name: string): string =>
  name?.charAt(0)?.toUpperCase() ?? '?';

export function OrderCard({ order, onOpen, isHighlighted = false }: Props) {
  const cart = order.cart ?? [];
  const photos = cart.slice(0, 3);
  const more = Math.max(0, cart.length - 3);

  const needsPO = order.lane === 'logistics' && !order.poIssued;
  const isLate =
    order.deliveryDate &&
    new Date(order.deliveryDate).getTime() < Date.now() &&
    order.lane !== 'delivered';

  // Slip state pill: only show for non-'none' states.
  const slipPill =
    order.slipState === 'pending'
      ? { className: styles.pillWarn, Icon: Clock, label: 'Awaiting check' }
      : order.slipState === 'verified'
        ? { className: styles.pillOk, Icon: ShieldCheck, label: 'Slip verified' }
        : order.slipState === 'flagged'
          ? { className: styles.pillBad, Icon: ShieldAlert, label: 'Slip flagged' }
          : null;

  const addressDisplay =
    order.customerCity ??
    order.customerAddress?.slice(0, 32) ??
    'Address pending';

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
        <div className={styles.address}>
          <MapPin size={11} strokeWidth={1.75} />
          <span>{addressDisplay}</span>
        </div>
      </div>

      {cart.length > 0 && (
        <div className={styles.photos}>
          {photos.map((p, i) => (
            <span
              key={`${p.productId}-${i}`}
              className={styles.photo}
              title={p.productName}
            >
              {productInitial(p.productName)}
            </span>
          ))}
          {more > 0 && (
            <span className={`${styles.photo} ${styles.photoMore}`}>+{more}</span>
          )}
        </div>
      )}

      <div className={styles.row}>
        <span className={styles.total}>
          <sup>RM</sup>
          {fmtMoney(order.total)}
        </span>
        <div className={styles.statuses}>
          {slipPill && (
            <span className={`${styles.pill} ${slipPill.className}`}>
              <slipPill.Icon size={11} strokeWidth={1.75} />
              {slipPill.label}
            </span>
          )}
          {needsPO && (
            <span className={`${styles.pill} ${styles.pillWarn}`}>
              <FileWarning size={11} strokeWidth={1.75} />
              Issue PO
            </span>
          )}
          {isLate && (
            <span className={`${styles.pill} ${styles.pillBad}`}>
              <AlertTriangle size={11} strokeWidth={1.75} />
              Late
            </span>
          )}
        </div>
      </div>

      <div className={`${styles.row} ${styles.staffRow}`}>
        <div className={styles.staff}>
          <span
            className={styles.staffDot}
            style={{ background: order.staffColor }}
          >
            {order.staffInitials}
          </span>
          <span>{order.staffName}</span>
        </div>
        <div className={styles.delivery}>
          <Calendar size={12} strokeWidth={1.75} />
          {order.deliveryDate ? fmtShortDate(order.deliveryDate) : 'Date TBD'}
        </div>
      </div>
    </button>
  );
}
