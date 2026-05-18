import { Recycle, ArrowUpFromLine, Wrench, Package } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AddonRow } from '../../lib/queries';
import type { AddonSelection } from '../../lib/handover-helpers';
import styles from './AddonCard.module.css';

const ICON: Record<string, LucideIcon> = {
  recycle: Recycle,
  'arrow-up-from-line': ArrowUpFromLine,
  wrench: Wrench,
};

export const AddonCard = ({
  addon, selection, onToggle, onChange,
}: {
  addon: AddonRow;
  selection: AddonSelection;
  onToggle: () => void;
  onChange: (s: AddonSelection) => void;
}) => {
  const Icon = ICON[addon.icon] ?? Package;

  const priceLine = addon.kind === 'floors_items'
    ? `RM${addon.perFloorItem} per floor per item`
    : `RM${addon.price} per ${addon.unit ?? 'piece'}`;

  const badgeAmount = addon.kind === 'floors_items'
    ? (addon.perFloorItem ?? 0)
    : addon.price;

  return (
    <article className={`${styles.card} ${selection.selected ? styles.cardOn : ''}`}>
      <div className={styles.summary}>
        <span className={styles.icon} aria-hidden="true">
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <div className={styles.body}>
          <h4 className={styles.title}>{addon.label}</h4>
          <p className={styles.detail}>
            {priceLine}
            {addon.description ? <> · {addon.description}</> : null}
          </p>
        </div>
        <span className={styles.badge}>+RM{badgeAmount}</span>
        <button
          type="button"
          className={`${styles.check} ${selection.selected ? styles.checkOn : ''}`}
          onClick={onToggle}
          aria-pressed={selection.selected}
          aria-label={selection.selected ? `Deselect ${addon.label}` : `Select ${addon.label}`}
        >
          <span aria-hidden="true">{selection.selected ? '●' : '○'}</span>
        </button>
      </div>
      {selection.selected && (addon.kind === 'qty' || addon.kind === 'floors_items') && (
        <div className={styles.expand}>
          {addon.kind === 'floors_items' ? (
            <>
              <label className={styles.expandField}>
                <span>Floors</span>
                <input
                  type="number"
                  min={0}
                  value={selection.floorsCount ?? 0}
                  onChange={(e) => onChange({ ...selection, floorsCount: Math.max(0, Number(e.target.value)) })}
                />
              </label>
              <label className={styles.expandField}>
                <span>Items to carry</span>
                <input
                  type="number"
                  min={0}
                  value={selection.itemsCount ?? 0}
                  onChange={(e) => onChange({ ...selection, itemsCount: Math.max(0, Number(e.target.value)) })}
                />
              </label>
            </>
          ) : (
            <label className={styles.expandField}>
              <span>Qty</span>
              <input
                type="number"
                min={1}
                value={selection.qty ?? 1}
                onChange={(e) => onChange({ ...selection, qty: Math.max(1, Number(e.target.value)) })}
              />
            </label>
          )}
        </div>
      )}
    </article>
  );
};
