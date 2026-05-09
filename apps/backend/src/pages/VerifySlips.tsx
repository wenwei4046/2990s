import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Inbox, ExternalLink } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useSlipQueue, type SlipQueueRow } from '../lib/queries';
import { SlipSection } from '../components/SlipSection';
import styles from './VerifySlips.module.css';

// Coordinator queue. One card per order whose slip is awaiting review.
// The slip image, Verify, and Flag actions are delegated to <SlipSection /> —
// same component the OrderDrawer uses, so behaviour stays in sync.
//
// Replace flow: a flagged slip needs the customer to send a fresh one. The POS
// re-uploads via the existing slip-init pipeline, which moves the row back to
// `pending`. So "Replace" from the coordinator's side reduces to "Flag with
// reason → wait for re-upload"; no separate replace action is required at the
// API level today.
export const VerifySlips = () => {
  const queue = useSlipQueue();
  const qc = useQueryClient();

  const onUpdated = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['slip-queue'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }, [qc]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className="t-eyebrow">Coordinator queue</div>
          <h2 className={styles.title}>Verify slips</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Inspect uploaded payment slips. Verify if the bank slip matches the order total.
            Flag with a reason if anything looks wrong — the customer will be asked to re-upload.
          </p>
        </div>
        {queue.data && queue.data.length > 0 && (
          <div className={styles.countBadge} aria-label="pending slip count">
            {queue.data.length} pending
          </div>
        )}
      </header>

      {queue.isLoading ? (
        <div className={styles.empty}>Loading queue…</div>
      ) : queue.error ? (
        <div className={styles.empty}>Failed to load: {String(queue.error)}</div>
      ) : (queue.data?.length ?? 0) === 0 ? (
        <EmptyState />
      ) : (
        <div className={styles.list}>
          {queue.data!.map((row) => (
            <SlipCard key={row.id} row={row} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  );
};

const EmptyState = () => (
  <div className={styles.empty}>
    <Inbox size={32} strokeWidth={1.5} />
    <p className={styles.emptyTitle}>Queue is clear</p>
    <p className="t-body fg-muted">
      No slips waiting on you. New uploads land here as POS sales come in.
    </p>
  </div>
);

interface SlipCardProps {
  row: SlipQueueRow;
  onUpdated: () => void;
}

const SlipCard = ({ row, onUpdated }: SlipCardProps) => {
  const placed = new Date(row.placedAt);
  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardHeaderLeft}>
          <div className={styles.orderId}>{row.id}</div>
          <div className={styles.customer}>{row.customerName}</div>
          {row.customerPhone && (
            <div className={styles.phone}>{row.customerPhone}</div>
          )}
        </div>
        <div className={styles.cardHeaderRight}>
          <div className={styles.total}>{fmtRM(row.total)}</div>
          <div className={styles.meta}>
            <span>{row.paymentMethod}</span>
            <span aria-hidden> · </span>
            <span>uploaded {relativeTime(placed)}</span>
          </div>
          <Link to={`/orders?orderId=${encodeURIComponent(row.id)}`} className={styles.openLink}>
            Open in Orders
            <ExternalLink size={14} strokeWidth={1.75} />
          </Link>
        </div>
      </header>

      <SlipSection
        orderId={row.id}
        slipKey={row.slipKey}
        slipState={row.slipState}
        slipVerifiedBy={row.slipVerifiedBy}
        slipVerifiedAt={row.slipVerifiedAt}
        slipFlagReason={row.slipFlagReason}
        onUpdated={onUpdated}
      />
    </article>
  );
};

// Tiny relative-time formatter (no library needed for "5 min ago" granularity).
function relativeTime(d: Date): string {
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return d.toLocaleDateString('en-MY');
}
