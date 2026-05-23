import { Banknote, CreditCard, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HandoverForm, AddonSelection } from '../../lib/handover-helpers';
import type { AddonRow } from '../../lib/queries';
import { AddonCard } from './AddonCard';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

const HANDOVER_ADDON_IDS = ['dispose-mattress', 'dispose-bedframe', 'lift', 'assemble'];

export const AddonsPaymentStep = ({
  form, update, addons,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  addons: AddonRow[];
}) => {
  const handoverAddons = addons.filter(
    (a) => HANDOVER_ADDON_IDS.includes(a.id) && a.enabled,
  );

  const setSelection = (id: string, sel: AddonSelection) =>
    update('addons', { ...form.addons, [id]: sel });

  return (
    <section className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Confirm &amp; payment</h2>
      <p className={styles.stepLead}>
        Review add-ons, record payment, then capture the customer signature to complete the order.
      </p>

      <h3 className="subTitle">Add-ons (optional)</h3>
      <p className={styles.stepLead}>One-time fees, added on top of the product price.</p>

      <div className={styles.addonList}>
        {handoverAddons.map((a) => {
          const sel: AddonSelection = form.addons[a.id] ?? { selected: false, expanded: false };
          return (
            <AddonCard
              key={a.id}
              addon={a}
              selection={sel}
              onToggle={() =>
                setSelection(a.id, {
                  ...sel,
                  selected: !sel.selected,
                  expanded: !sel.selected || sel.expanded,
                })
              }
              onChange={(next) => setSelection(a.id, next)}
            />
          );
        })}
      </div>

      <h3 className="subTitle">Additional delivery fee (optional)</h3>
      <p className={styles.stepLead}>
        Use this for non-standard delivery situations (outstation, urgent slot,
        oversized item). Leave blank for none.
      </p>

      <Field label="Amount (RM)">
        <input
          type="number"
          min={0}
          step={1}
          value={form.additionalDeliveryFee || ''}
          onChange={(e) => {
            const v = e.target.value;
            update(
              'additionalDeliveryFee',
              v === '' ? 0 : Math.max(0, Math.floor(Number(v))),
            );
          }}
          placeholder="0"
        />
      </Field>
      <p className={styles.signCaption}>
        Adds on top of the base fee and any cross-category surcharge.
        Whole RM, no sen.
      </p>

      <h3 className="subTitle">Payment method</h3>
      <div className="fieldRow">
        <MethodButton
          active={form.paymentMethod === 'merchant'}
          icon={CreditCard}
          label="Merchant"
          hint="Card via GHL / HLB / MBB / PBB terminal"
          onClick={() => { update('paymentMethod', 'merchant'); update('installmentMonths', null); }}
        />
        <MethodButton
          active={form.paymentMethod === 'transfer'}
          icon={Banknote}
          label="Bank transfer / DuitNow"
          hint="Slip required"
          onClick={() => { update('paymentMethod', 'transfer'); update('installmentMonths', null); update('merchantProvider', null); }}
        />
      </div>
      <div className="fieldRow">
        <MethodButton
          active={form.paymentMethod === 'installment'}
          icon={Clock}
          label="Installment"
          hint="Agreement / contract no."
          onClick={() => { update('paymentMethod', 'installment'); update('merchantProvider', null); }}
        />
      </div>
      {form.paymentMethod === 'merchant' && (
        <div className={styles.installmentTerm} role="group" aria-label="Merchant">
          <span className={styles.installmentTermLabel}>Merchant</span>
          {(['GHL', 'HLB', 'MBB', 'PBB'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`${styles.termChip} ${form.merchantProvider === p ? styles.termChipActive : ''}`}
              aria-pressed={form.merchantProvider === p}
              onClick={() => update('merchantProvider', p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}
      {form.paymentMethod === 'installment' && (
        <div className={styles.installmentTerm} role="group" aria-label="Installment term">
          <span className={styles.installmentTermLabel}>Term</span>
          {([6, 12] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${styles.termChip} ${form.installmentMonths === m ? styles.termChipActive : ''}`}
              aria-pressed={form.installmentMonths === m}
              onClick={() => update('installmentMonths', m)}
            >
              {m} months
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

const MethodButton = ({
  active, icon: Icon, label, hint, onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  hint: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`${styles.methodBtn} ${active ? styles.methodBtnActive : ''}`}
    aria-pressed={active}
  >
    <span className={styles.methodIcon} aria-hidden="true">
      <Icon size={20} strokeWidth={1.75} />
    </span>
    <span>
      <strong className={styles.methodLabel}>{label}</strong>
      <span className={styles.methodHint}>{hint}</span>
    </span>
  </button>
);
