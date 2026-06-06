import { useEffect } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { PAYMENT_METHOD_CODES, type PaymentMethodCode } from '@2990s/shared/payment-methods';
import { Field } from './Field';
import { SlipUploadStep } from '../SlipUploadStep';
import { MERCHANT_FALLBACK, INSTALLMENT_FALLBACK, parseTermMonths } from './AddonsPaymentStep';
import { collectedTotal, type HandoverForm, type ExtraPayment } from '../../lib/handover-helpers';
import { usePaymentMethodLabels, useSoDropdownValues } from '../../lib/so-maintenance/so-dropdown-options-queries';
import styles from '../../pages/Handover.module.css';

export const ConfirmPaymentStep = ({
  form, update, subtotal, addonTotal, deliveryFeeTotal,
}: {
  form: HandoverForm;
  update: <K extends keyof HandoverForm>(k: K, v: HandoverForm[K]) => void;
  subtotal: number;
  addonTotal: number;
  deliveryFeeTotal: number;
}) => {
  // Payable total = the WHOLE order (goods + add-ons + delivery), so the
  // deposit floor + full-payment ceiling match the Order summary on the right.
  const total = subtotal + addonTotal + deliveryFeeTotal;
  const halfTotal = Math.round(total / 2);
  const seventyTotal = Math.round(total * 0.7);

  // Sync the initial preset='full' default with the actual cart total on
  // first mount. The form is initialized in Handover.tsx with amountPaid=0
  // because total isn't known yet, but presetPill renders 'full' as active
  // — visually misleading. Hydrate the amount once on entry.
  useEffect(() => {
    if (form.amountPaid === 0 && form.paymentPreset === 'full' && total > 0) {
      update('amountPaid', total);
    }
    // Intentional: run once on mount to seed the default; subsequent edits
    // are user-driven via input/presets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPreset = (preset: HandoverForm['paymentPreset'], amount: number) => {
    update('paymentPreset', preset);
    update('amountPaid', amount);
  };

  const inferPreset = (amount: number): HandoverForm['paymentPreset'] => {
    if (amount === halfTotal) return 'half';
    if (amount === total) return 'full';
    if (amount === seventyTotal) return 'seventy';
    return 'custom';
  };

  /* 2026-06-06 payment-method unify — label follows the live maintenance
     row, so a rename in SO Maintenance shows here too. */
  const methodLabels = usePaymentMethodLabels() as Record<string, string>;
  const methodLabel = methodLabels[form.paymentMethod] ?? '—';

  /* Split payment (Loo 2026-06-06) — extra transactions on top of the primary
     one (e.g. half cash + half card). Same maintained sources as the primary
     cascade: merchants + installment terms from SO Maintenance. */
  const extras = form.extraPayments ?? [];
  const merchants = useSoDropdownValues('payment_merchant', MERCHANT_FALLBACK);
  const parsedTerms = Array.from(new Set(
    useSoDropdownValues('installment_plan', INSTALLMENT_FALLBACK)
      .map((o) => parseTermMonths(o.value))
      .filter((n): n is number => n !== null),
  )).sort((a, b) => a - b);
  const installmentTerms = parsedTerms.length > 0 ? parsedTerms : [6, 12];
  const collected = collectedTotal(form);

  const setExtras = (next: ExtraPayment[]) => update('extraPayments', next);
  const patchExtra = (i: number, patch: Partial<ExtraPayment>) =>
    setExtras(extras.map((p, idx) => {
      if (idx !== i) return p;
      const next = { ...p, ...patch };
      // Method switch clears the sub-fields that don't apply (mirrors the
      // primary cascade's selectMethod), so a Merchant→Cash flip never
      // submits a stale bank or term.
      if (patch.method) {
        if (patch.method !== 'merchant') next.merchantProvider = null;
        if (patch.method !== 'installment') next.installmentMonths = null;
      }
      return next;
    }));

  return (
    <section className={styles.stepBody}>
      <h2 className={styles.stepTitle}>Confirm payment</h2>
      <p className={styles.stepLead}>
        Record the payment received via <strong>{methodLabel}</strong>. Customer can pay any amount between{' '}
        <strong>50% deposit</strong> ({fmtRM(halfTotal)}) and the full total ({fmtRM(total)}).
      </p>

      <div className={styles.amountCard}>
        <span className={styles.amountLabel}>Amount paid</span>
        <div className={styles.amountInputWrap}>
          <span className={styles.amountPrefix}>RM</span>
          <input
            type="number"
            min={halfTotal}
            max={total}
            value={form.amountPaid || ''}
            onChange={(e) => {
              const v = Number(e.target.value);
              update('amountPaid', v);
              update('paymentPreset', inferPreset(v));
            }}
            placeholder={String(total)}
            className={styles.amountInput}
          />
        </div>
      </div>

      <div className={styles.presetRow}>
        <PresetPill
          active={form.paymentPreset === 'half'}
          onClick={() => setPreset('half', halfTotal)}
        >
          50% deposit · {fmtRM(halfTotal)}
        </PresetPill>
        <PresetPill
          active={form.paymentPreset === 'full'}
          onClick={() => setPreset('full', total)}
        >
          Full payment · {fmtRM(total)}
        </PresetPill>
        <PresetPill
          active={form.paymentPreset === 'seventy'}
          onClick={() => setPreset('seventy', seventyTotal)}
        >
          70% · {fmtRM(seventyTotal)}
        </PresetPill>
      </div>

      <Field label="Approval code *">
        <input
          type="text"
          value={form.approvalCode}
          onChange={(e) => update('approvalCode', e.target.value)}
          placeholder={
            form.paymentMethod === 'transfer'
              ? 'DuitNow / bank reference'
              : form.paymentMethod === 'installment'
                ? 'Agreement / contract no.'
                : form.paymentMethod === 'cash'
                  ? 'Cash receipt / reference no.'
                  : 'Approval code from POS terminal'
          }
        />
      </Field>

      {/* ── Split payment (Loo 2026-06-06) — extra transactions ───────── */}
      <h3 className="subTitle">Split payment (optional)</h3>
      <p className={styles.stepLead}>
        Customer paying with more than one method? Add each extra transaction —
        the order books every one to the payment ledger.
      </p>
      {extras.map((p, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(120px, 1fr) minmax(100px, 0.8fr) minmax(140px, 1fr) auto',
            gap: 8,
            alignItems: 'end',
            padding: '10px 12px',
            border: '1px solid var(--border, #E6DFD5)',
            borderRadius: 10,
            marginBottom: 8,
          }}
        >
          <Field label={`Payment ${i + 2} method *`}>
            <select
              value={p.method}
              onChange={(e) => patchExtra(i, { method: e.target.value as PaymentMethodCode })}
            >
              {PAYMENT_METHOD_CODES.map((code) => (
                <option key={code} value={code}>{methodLabels[code] ?? code}</option>
              ))}
            </select>
          </Field>
          <Field label="Amount (RM) *">
            <input
              type="number"
              min={1}
              value={p.amount || ''}
              onChange={(e) => patchExtra(i, { amount: Number(e.target.value) || 0 })}
              placeholder="0"
            />
          </Field>
          <Field label="Approval code *">
            <input
              type="text"
              value={p.approvalCode}
              onChange={(e) => patchExtra(i, { approvalCode: e.target.value })}
              placeholder={
                p.method === 'transfer' ? 'DuitNow / bank reference'
                  : p.method === 'installment' ? 'Agreement / contract no.'
                    : p.method === 'cash' ? 'Cash receipt / reference no.'
                      : 'Approval code from POS terminal'
              }
            />
          </Field>
          <button
            type="button"
            onClick={() => setExtras(extras.filter((_, idx) => idx !== i))}
            title="Remove this payment"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--fg-muted, #8A8378)' }}
          >
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
          {p.method === 'merchant' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Merchant *">
                <select
                  value={p.merchantProvider ?? ''}
                  onChange={(e) => patchExtra(i, { merchantProvider: e.target.value || null })}
                >
                  <option value="">Select…</option>
                  {merchants.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          {p.method === 'installment' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="Installment term *">
                <select
                  value={p.installmentMonths ?? ''}
                  onChange={(e) => patchExtra(i, { installmentMonths: e.target.value ? Number(e.target.value) : null })}
                >
                  <option value="">Select…</option>
                  {installmentTerms.map((t) => (
                    <option key={t} value={t}>{t} months</option>
                  ))}
                </select>
              </Field>
            </div>
          )}
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label={`Payment ${i + 2} slip / proof *`}>
              <SlipUploadStep
                onConfirmed={(id) => patchExtra(i, { slipUploadSessionId: id })}
                onCleared={() => patchExtra(i, { slipUploadSessionId: null })}
              />
            </Field>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={styles.presetPill}
        onClick={() => setExtras([
          ...extras,
          { method: 'cash', amount: 0, approvalCode: '', merchantProvider: null, installmentMonths: null, slipUploadSessionId: null },
        ])}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <Plus size={14} strokeWidth={2} />
        Add payment
      </button>
      {extras.length > 0 && (
        <p className={styles.stepLead} style={{ marginTop: 8 }}>
          Total collected: <strong>{fmtRM(collected)}</strong> of {fmtRM(total)}
          {' '}({methodLabel} {fmtRM(form.amountPaid)}
          {extras.map((p, i) => (
            <span key={i}> + {methodLabels[p.method] ?? p.method} {fmtRM(p.amount || 0)}</span>
          ))})
        </p>
      )}

      <h3 className="subTitle">
        Payment 1 slip / proof <span className={styles.required}>*</span>
      </h3>
      <SlipUploadStep
        onConfirmed={(id) => update('slipUploadSessionId', id)}
        onCleared={() => update('slipUploadSessionId', null)}
      />

      {form.paymentRecorded && (
        <p className={styles.recordedNote}>
          <Check size={14} strokeWidth={2} />
          Payment recorded · {fmtRM(collected)}{extras.length > 0 ? ` (${extras.length + 1} transactions)` : ''}
        </p>
      )}
    </section>
  );
};

const PresetPill = ({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`${styles.presetPill} ${active ? styles.presetPillActive : ''}`}
    aria-pressed={active}
  >
    {children}
  </button>
);
