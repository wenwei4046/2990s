import { Banknote, CreditCard, Clock } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HandoverForm, AddonSelection } from '../../lib/handover-helpers';
import type { AddonRow } from '../../lib/queries';
import { AddonCard } from './AddonCard';
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

      <h3 className="subTitle">Payment method</h3>
      <div className="fieldRow">
        <MethodButton
          active={form.paymentMethod === 'credit'}
          icon={CreditCard}
          label="Credit Card"
          hint="Approval code from terminal"
          onClick={() => update('paymentMethod', 'credit')}
        />
        <MethodButton
          active={form.paymentMethod === 'debit'}
          icon={CreditCard}
          label="Debit Card"
          hint="Approval code from terminal"
          onClick={() => update('paymentMethod', 'debit')}
        />
      </div>
      <div className="fieldRow">
        <MethodButton
          active={form.paymentMethod === 'transfer'}
          icon={Banknote}
          label="Bank transfer / DuitNow"
          hint="Slip required"
          onClick={() => update('paymentMethod', 'transfer')}
        />
        <MethodButton
          active={form.paymentMethod === 'installment'}
          icon={Clock}
          label="Installment"
          hint="Agreement / contract no."
          onClick={() => update('paymentMethod', 'installment')}
        />
      </div>
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
