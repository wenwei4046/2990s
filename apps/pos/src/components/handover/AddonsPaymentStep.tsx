import { Banknote, CreditCard, Clock, Wallet, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  PAYMENT_METHOD_CODE_TO_VALUE,
  PAYMENT_METHOD_DEFAULT_LABELS,
  paymentMethodCodeForValue,
  type PaymentMethodCode,
} from '@2990s/shared/payment-methods';
import type { HandoverForm, AddonSelection } from '../../lib/handover-helpers';
import type { AddonRow } from '../../lib/queries';
import { useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import { AddonCard } from './AddonCard';
import { Field } from './Field';
import styles from '../../pages/Handover.module.css';

const HANDOVER_ADDON_IDS = ['dispose-mattress', 'dispose-bedframe', 'lift', 'assemble'];

/* Fallbacks shown until /so-dropdown-options loads — the pre-maintenance
   hardcoded sets. The live lists come from the payment_method,
   payment_merchant and installment_plan categories on the SO Maintenance
   page. */
const MERCHANT_FALLBACK = ['GHL', 'HLB', 'MBB', 'PBB'].map((v) => ({ value: v, label: v }));
const INSTALLMENT_FALLBACK = [
  { value: '6 months', label: '6 months' },
  { value: '12 months', label: '12 months' },
];

/* 2026-06-06 payment-method unify (Loo: "all same together and decide from
   so maintenance page") — the four method cards now render from the
   payment_method maintenance rows: label + order are live, while the VALUE
   is the locked key that resolves to the internal code the branch logic
   still switches on. The API locks the category to exactly these four rows
   (rename/reorder only), so the icon/hint/behaviour maps below stay keyed
   by code. */
const METHOD_FALLBACK = (['merchant', 'transfer', 'installment', 'cash'] as const).map((code) => ({
  value: PAYMENT_METHOD_CODE_TO_VALUE[code],
  label: PAYMENT_METHOD_DEFAULT_LABELS[code],
}));

const METHOD_ICON: Record<PaymentMethodCode, LucideIcon> = {
  merchant:    CreditCard,
  transfer:    Banknote,
  installment: Clock,
  cash:        Wallet,
};

const METHOD_HINT: Record<PaymentMethodCode, string> = {
  merchant:    'Card via merchant terminal',
  transfer:    'Slip required',
  installment: 'Agreement / contract no.',
  cash:        'Cash received at counter',
};

/** "6 months" / "12 Months" → 6 / 12. Non-term rows ("One-off") are skipped —
 *  installment_months on the SO is an integer term. */
const parseTermMonths = (value: string): number | null => {
  const m = /^(\d+)\s*month/i.exec(value.trim());
  return m ? Number(m[1]) : null;
};

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

  /* The four cards, live from SO Maintenance — label + sort follow the
     maintenance rows; the code drives icons, hints and branch behaviour.
     Rows whose value doesn't resolve to a core code are skipped (can't
     happen while the API lock holds, but a render must never crash). */
  const methodCards = useSoDropdownValues('payment_method', METHOD_FALLBACK)
    .map((o) => ({ code: paymentMethodCodeForValue(o.value), label: o.label }))
    .filter((m): m is { code: PaymentMethodCode; label: string } => m.code !== null);

  /* Picking a method clears the sub-fields that don't apply to it, so a
     Merchant→Cash switch never submits a stale bank or term. */
  const selectMethod = (code: PaymentMethodCode) => {
    update('paymentMethod', code);
    if (code !== 'installment') update('installmentMonths', null);
    if (code !== 'merchant') update('merchantProvider', null);
  };

  const merchants = useSoDropdownValues('payment_merchant', MERCHANT_FALLBACK);
  const parsedTerms = Array.from(new Set(
    useSoDropdownValues('installment_plan', INSTALLMENT_FALLBACK)
      .map((o) => parseTermMonths(o.value))
      .filter((n): n is number => n !== null),
  )).sort((a, b) => a - b);
  // The maintained list can legitimately contain only non-term rows (e.g.
  // just "One-off") — never leave the installment picker with zero chips,
  // or the step's validation gate becomes unpassable.
  const installmentTerms = parsedTerms.length > 0 ? parsedTerms : [6, 12];

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
      {/* Two cards per row — same 2×2 grid as before, now driven by the
          maintenance order. */}
      {Array.from({ length: Math.ceil(methodCards.length / 2) }, (_, i) =>
        methodCards.slice(i * 2, i * 2 + 2),
      ).map((pair) => (
        <div className="fieldRow" key={pair.map((m) => m.code).join('-')}>
          {pair.map((m) => (
            <MethodButton
              key={m.code}
              active={form.paymentMethod === m.code}
              icon={METHOD_ICON[m.code]}
              label={m.label}
              hint={METHOD_HINT[m.code]}
              onClick={() => selectMethod(m.code)}
            />
          ))}
        </div>
      ))}
      {form.paymentMethod === 'merchant' && (
        <div className={styles.installmentTerm} role="group" aria-label="Merchant">
          <span className={styles.installmentTermLabel}>Merchant</span>
          {merchants.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`${styles.termChip} ${form.merchantProvider === p.value ? styles.termChipActive : ''}`}
              aria-pressed={form.merchantProvider === p.value}
              onClick={() => update('merchantProvider', p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {form.paymentMethod === 'installment' && (
        <div className={styles.installmentTerm} role="group" aria-label="Installment term">
          <span className={styles.installmentTermLabel}>Term</span>
          {installmentTerms.map((m) => (
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
