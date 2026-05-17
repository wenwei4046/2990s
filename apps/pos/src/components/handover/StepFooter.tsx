import type { MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '@2990s/design-system';
import styles from './StepFooter.module.css';

type StepKey = 'customer'|'address'|'emergency'|'target'|'addons'|'confirm'|'sign';

export const StepFooter = ({
  isFirst, currentKey, valid, submitting, paymentRecorded,
  onPrev, onNext, onRecordPayment,
}: {
  isFirst: boolean;
  currentKey: StepKey;
  valid: boolean;
  submitting: boolean;
  paymentRecorded: boolean;
  onPrev: () => void;
  onNext: () => void | Promise<void>;
  onRecordPayment: () => void;
}) => {
  const isConfirmStep = currentKey === 'confirm';
  const isSignStep = currentKey === 'sign';

  // P2.2 button label flips after payment is recorded.
  const primaryLabel = isSignStep
    ? 'Complete order'
    : isConfirmStep && !paymentRecorded
      ? 'Confirm payment received'
      : isConfirmStep
        ? 'Continue to signature'
        : 'Continue';

  // P2.2 first press = record; second press = advance. Override the
  // valid-gate so the first press isn't blocked by validateConfirmPayment
  // (which requires paymentRecorded=true).
  const handlePrimary = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (isConfirmStep && !paymentRecorded) {
      onRecordPayment();
      return;
    }
    void onNext();
  };

  // Disable rule:
  // - submitting → disabled
  // - confirm step + not recorded → enabled so user can attempt the
  //   record-press; inline form validation surfaces issues.
  // - confirm step + recorded → standard valid gate.
  // - other steps → standard valid gate.
  const disabled =
    submitting ||
    (!isConfirmStep && !valid) ||
    (isConfirmStep && paymentRecorded && !valid);

  return (
    <div className={styles.bar}>
      {!isFirst ? (
        <Button type="button" variant="ghost" onClick={onPrev} disabled={submitting}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Previous
        </Button>
      ) : (
        <span aria-hidden="true" />
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={disabled}
        onClick={handlePrimary}
      >
        {submitting ? 'Placing order…' : primaryLabel}
        {!submitting && (isSignStep
          ? <Check size={14} strokeWidth={2} />
          : <ArrowRight size={14} strokeWidth={1.75} />)}
      </Button>
    </div>
  );
};
