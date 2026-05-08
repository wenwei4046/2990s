import { fmtRM } from '@2990s/shared';
import { Button, PriceTag } from '@2990s/design-system';
import type { PricingDriftPayload } from '../lib/orders';
import styles from './PricingDriftModal.module.css';

interface Props {
  drift: PricingDriftPayload;
  submitting?: boolean;
  onAccept: (newTotal: number) => void;
  onCancel: () => void;
}

export const PricingDriftModal = ({ drift, submitting, onAccept, onCancel }: Props) => {
  const delta = drift.serverTotal - drift.clientTotal;
  const movedHeading = delta === 0
    ? 'Pricing reconciled'
    : `Total moved ${delta > 0 ? 'up' : 'down'} by ${fmtRM(Math.abs(delta))}`;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="drift-title">
      <div className={styles.card}>
        <span className={styles.eyebrow}>Pricing changed while you were configuring</span>
        <h2 id="drift-title" className={styles.title}>
          {movedHeading}
        </h2>
        <p className={styles.body}>
          Your customer was quoted <strong>{fmtRM(drift.clientTotal)}</strong>, but current
          catalog pricing makes the order <strong>{fmtRM(drift.serverTotal)}</strong>.
          Confirm the new total before placing the order.
        </p>

        <div className={styles.compareRow}>
          <div className={styles.compareCell}>
            <span className="t-eyebrow">Quoted</span>
            <PriceTag amount={drift.clientTotal} size="md" />
          </div>
          <div className={styles.arrow}>→</div>
          <div className={styles.compareCell}>
            <span className="t-eyebrow">Current</span>
            <PriceTag amount={drift.serverTotal} size="md" />
          </div>
        </div>

        <ul className={styles.lines}>
          {drift.lines.map((l, i) => (
            <li key={i} className={styles.line}>
              <div className={styles.lineHead}>
                <code className={styles.lineSku}>{l.productId.slice(0, 8)}…</code>
                <span className={styles.lineQty}>× {l.qty}</span>
                <span className={styles.lineTotal}>{fmtRM(l.lineTotal)}</span>
              </div>
              <div className={styles.lineBreakdown}>{l.breakdown.join(' · ')}</div>
            </li>
          ))}
        </ul>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onAccept(drift.serverTotal)}
            disabled={submitting}
          >
            {submitting ? 'Placing order…' : `Accept · ${fmtRM(drift.serverTotal)} & place order`}
          </Button>
        </div>
      </div>
    </div>
  );
};
