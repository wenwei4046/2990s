import { useState } from 'react';
import { Recycle, ArrowUpFromLine, Wrench, Package } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MAX_LIFT_TIER_FLOOR } from '@2990s/shared/service-sku';
import type { AddonRow } from '../../lib/queries';
import type { AddonSelection } from '../../lib/handover-helpers';
import styles from './AddonCard.module.css';

const ICON: Record<string, LucideIcon> = {
  recycle: Recycle,
  'arrow-up-from-line': ArrowUpFromLine,
  wrench: Wrench,
};

/* − / + buttons flanking each count input (same stepper pattern as the cart
   lines). iPad Safari renders no native number-spinner arrows, so without
   these the only way to change a count on the tablet is the keyboard. */
const StepBtn = ({ glyph, label, disabled, onStep }: {
  glyph: '−' | '+';
  label: string;
  disabled: boolean;
  onStep: () => void;
}) => (
  <button
    type="button"
    className={styles.stepBtn}
    onClick={onStep}
    disabled={disabled}
    aria-label={label}
  >{glyph}</button>
);

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

  /* Stepping bases off selection.qty: the input's onChange pushes every valid
     draft there live, and an empty/garbage draft means the last committed
     value is the only sensible base anyway — so tapping + mid-edit never NaNs. */
  const qtyNow = selection.qty ?? 1;
  const stepQty = (delta: number) => {
    setQtyDraft(null);
    onChange({ ...selection, qty: Math.min(99, Math.max(1, qtyNow + delta)) });
  };

  const floorsNow = selection.floorsCount ?? 0;
  const stepFloors = (delta: number) =>
    onChange({ ...selection, floorsCount: Math.min(MAX_LIFT_TIER_FLOOR, Math.max(0, floorsNow + delta)) });

  const itemsNow = selection.itemsCount ?? 0;
  const stepItems = (delta: number) =>
    onChange({ ...selection, itemsCount: Math.max(0, itemsNow + delta) });

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
              {/* htmlFor (not label-wrapping alone) — with buttons inside the
                  label, the implicit association would land on the − button
                  (first labelable descendant), so tapping the caption would
                  decrement. The explicit for/id pins it to the input. */}
              <label className={styles.expandField} htmlFor={`addon-floors-${addon.id}`}>
                {/* Capped at the per-floor tier SKU ceiling (Loo 2026-06-11:
                    we don't carry above the 5th floor) — keeps every order on
                    a SVC-LIFT-CARRY-F* SKU instead of the legacy fallback. */}
                <span>Floors</span>
                <div className={styles.stepper}>
                  <StepBtn glyph="−" label="Fewer floors" disabled={floorsNow <= 0} onStep={() => stepFloors(-1)} />
                  <input
                    id={`addon-floors-${addon.id}`}
                    type="number"
                    min={0}
                    max={MAX_LIFT_TIER_FLOOR}
                    value={selection.floorsCount ?? 0}
                    onChange={(e) => onChange({ ...selection, floorsCount: Math.min(MAX_LIFT_TIER_FLOOR, Math.max(0, Number(e.target.value))) })}
                  />
                  <StepBtn glyph="+" label="More floors" disabled={floorsNow >= MAX_LIFT_TIER_FLOOR} onStep={() => stepFloors(1)} />
                </div>
              </label>
              <label className={styles.expandField} htmlFor={`addon-items-${addon.id}`}>
                <span>Items to carry</span>
                <div className={styles.stepper}>
                  <StepBtn glyph="−" label="Fewer items" disabled={itemsNow <= 0} onStep={() => stepItems(-1)} />
                  <input
                    id={`addon-items-${addon.id}`}
                    type="number"
                    min={0}
                    value={selection.itemsCount ?? 0}
                    onChange={(e) => onChange({ ...selection, itemsCount: Math.max(0, Number(e.target.value)) })}
                  />
                  <StepBtn glyph="+" label="More items" disabled={false} onStep={() => stepItems(1)} />
                </div>
              </label>
            </>
          ) : (
            <label className={styles.expandField} htmlFor={`addon-qty-${addon.id}`}>
              <span>Qty</span>
              <div className={styles.stepper}>
                <StepBtn glyph="−" label="Decrease quantity" disabled={qtyNow <= 1} onStep={() => stepQty(-1)} />
                <input
                  id={`addon-qty-${addon.id}`}
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
                <StepBtn glyph="+" label="Increase quantity" disabled={qtyNow >= 99} onStep={() => stepQty(1)} />
              </div>
            </label>
          )}
        </div>
      )}
    </article>
  );
};
