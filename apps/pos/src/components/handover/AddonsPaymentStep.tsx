import { Banknote, CreditCard, Clock, Wallet, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HandoverForm, AddonSelection } from '../../lib/handover-helpers';
import type { AddonRow } from '../../lib/queries';
import { AddonCard } from './AddonCard';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

const HANDOVER_ADDON_IDS = ['dispose-mattress', 'dispose-bedframe', 'lift', 'assemble'];

/** Live status of the typed "Previous SO number" (server-validated). */
export interface CrossCategoryLinkStatus {
  show:       boolean;   // an SO number has been typed
  checking:   boolean;   // validation in flight / debouncing
  eligible:   boolean;   // valid + eligible → discount applies
  message:    string | null;  // reason when invalid
  debtorName: string | null;  // matched customer name when eligible
}

/** Controls for the "Auto-match" button (scan the customer's earlier SOs). */
export interface AutoMatchControls {
  canRun:   boolean;       // customer name + phone are both present
  loading:  boolean;       // a scan is in flight
  notFound: boolean;       // the last scan found no linkable earlier SO
  run:      () => void;    // start a scan
  clear:    () => void;    // reset notFound (when the SO field is edited by hand)
}

export const AddonsPaymentStep = ({
  form, update, addons, linkStatus, autoMatch,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  addons: AddonRow[];
  linkStatus: CrossCategoryLinkStatus;
  autoMatch: AutoMatchControls;
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

      <h3 className="subTitle">Cross-category — link previous order (optional)</h3>
      <p className={styles.stepLead}>
        If this customer already placed an earlier order for a different category
        (e.g. a mattress) that can&apos;t share this sales order, enter that order&apos;s
        SO number. Delivery here is then charged the reduced cross-category rate
        (or the special model&apos;s cross-category price) instead of a fresh full fee.
      </p>

      {/* Manual <div className="field"> (not <Field>, which renders a <label>) so
          the Auto-match <button> beside the input isn't captured by the label. */}
      <div className="field">
        <span className="fieldLabel">Previous SO number</span>
        <div className={styles.soMatchRow}>
          <input
            type="text"
            value={form.crossCategorySourceSo}
            onChange={(e) => { update('crossCategorySourceSo', e.target.value); autoMatch.clear(); }}
            placeholder="e.g. SO-2605"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            className={styles.soMatchBtn}
            onClick={autoMatch.run}
            disabled={!autoMatch.canRun || autoMatch.loading}
          >
            <Search size={16} strokeWidth={1.75} />
            {autoMatch.loading ? 'Scanning…' : 'Auto-match'}
          </button>
        </div>
      </div>
      {linkStatus.show ? (
        linkStatus.checking ? (
          <p className={styles.signCaption}>Checking order number…</p>
        ) : linkStatus.eligible ? (
          <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--c-festive-a)' }}>
            <CheckCircle2 size={16} strokeWidth={1.75} />
            Linked{linkStatus.debtorName ? ` to ${linkStatus.debtorName}` : ''} — cross-category rate applies.
          </p>
        ) : (
          <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--c-festive-b)' }}>
            <AlertCircle size={16} strokeWidth={1.75} />
            {linkStatus.message ?? 'This order number is not valid.'}
          </p>
        )
      ) : autoMatch.loading ? (
        <p className={styles.signCaption}>Scanning this customer&apos;s earlier orders…</p>
      ) : autoMatch.notFound ? (
        <p style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--c-festive-b)' }}>
          <AlertCircle size={16} strokeWidth={1.75} />
          No earlier order found for this customer.
        </p>
      ) : (
        <p className={styles.signCaption}>
          Leave blank for a standalone order. Tap Auto-match to fill it from this
          customer&apos;s earlier orders, or type it — the SO number is checked live.
        </p>
      )}

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
        <MethodButton
          active={form.paymentMethod === 'cash'}
          icon={Wallet}
          label="Cash"
          hint="Cash received at counter"
          onClick={() => { update('paymentMethod', 'cash'); update('installmentMonths', null); update('merchantProvider', null); }}
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
