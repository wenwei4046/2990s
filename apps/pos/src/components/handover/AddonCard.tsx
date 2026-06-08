import { useState } from 'react';
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

  /* Qty editing: while the field has focus we let the user clear it and type
     freely (draft string, can be '' / '0'); we only clamp to [1,99] on blur
     (empty → 1). A keystroke-time clamp made the field snap back to 1 the
     instant you backspaced, so you could never type a new number. When the
     draft is null the field is controlled straight off selection.qty. */
  const [qtyDraft, setQtyDraft] = useState<string | null>(null);
  const qtyValue = qtyDraft ?? String(selection.qty ?? 1);

  const priceLine = addon.kind === 'floors_items'
    ? `RM${addon.perFloorItem} per floor per item`
    : addon.kind === 'flat'
      // flat books exactly once (no qty control below) — a per-unit label
      // here would promise per-piece pricing the SO never charges.
      ? `RM${addon.price} · charged once`
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
                max={99}
                value={qtyValue}
                onChange={(e) => {
                  const raw = e.target.value;
                  setQtyDraft(raw);
                  // Push a live value only when it's already a valid qty, so the
                  // preview total tracks typing — but never force it to 1 mid-edit
                  // (that's what the old keystroke clamp did). Server caps at 99.
                  const n = Number(raw);
                  if (raw !== '' && Number.isFinite(n) && n >= 1) {
                    onChange({ ...selection, qty: Math.min(99, Math.floor(n)) });
                  }
                }}
                onBlur={() => {
                  const n = Number(qtyDraft ?? '');
                  const clamped =
                    qtyDraft === '' || !Number.isFinite(n)
                      ? 1
                      : Math.min(99, Math.max(1, Math.floor(n)));
                  onChange({ ...selection, qty: clamped });
                  setQtyDraft(null); // back to controlled off selection.qty
                }}
              />
            </label>
          )}
        </div>
      )}
    </article>
  );
};
