import { useEffect } from 'react';
import { Check } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { Field } from './Field';
import { SlipUploadStep } from '../SlipUploadStep';
import type { HandoverForm } from '../../lib/handover-helpers';
import styles from '../../pages/Handover.module.css';

const METHOD_LABEL: Record<string, string> = {
  merchant: 'Merchant',
  transfer: 'Bank transfer / DuitNow',
  installment: 'Installment',
  cash: 'Cash',
};

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

  const methodLabel = METHOD_LABEL[form.paymentMethod] ?? '—';

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

      <h3 className="subTitle">
        Payment slip / proof <span className={styles.required}>*</span>
      </h3>
      <SlipUploadStep
        onConfirmed={(id) => update('slipUploadSessionId', id)}
        onCleared={() => update('slipUploadSessionId', null)}
      />

      {form.paymentRecorded && (
        <p className={styles.recordedNote}>
          <Check size={14} strokeWidth={2} />
          Payment recorded · {fmtRM(form.amountPaid)}
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
