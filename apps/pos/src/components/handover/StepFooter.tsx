import type { MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { Button } from '@2990s/design-system';
import styles from './StepFooter.module.css';

type StepKey = 'customer'|'address'|'emergency'|'target'|'addons'|'confirm'|'sign';

export const StepFooter = ({
  isFirst, currentKey, valid, submitting, paymentRecorded, blockers, attempted,
  onPrev, onNext, onRecordPayment,
}: {
  isFirst: boolean;
  currentKey: StepKey;
  valid: boolean;
  submitting: boolean;
  paymentRecorded: boolean;
  blockers: string[];
  attempted: boolean;
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

  // Two-tier disable:
  // - hardDisabled (HTML disabled) → only while submitting. Other invalid
  //   states keep the button clickable so users can hit Continue and find
  //   out WHY it's not advancing (banner appears via attempted state).
  // - muted (visual only) → invalid form. Button looks dimmed but click
  //   still fires handlePrimary → goNext → setAttempted(true).
  const hardDisabled = submitting;
  const muted =
    (!isConfirmStep && !valid) ||
    (isConfirmStep && paymentRecorded && !valid);

  // Banner only surfaces AFTER user clicks Continue on an invalid step.
  // Stays visible while they fix things, vanishes once everything passes.
  const showBlockers = attempted && (muted || (isConfirmStep && !paymentRecorded && !valid)) && blockers.length > 0;

  return (
    <div className={styles.wrap}>
      {showBlockers && (
        <div className={styles.blockers}>
          <AlertCircle size={14} strokeWidth={1.75} />
          <div className={styles.blockerList}>
            <span className={styles.blockerHead}>
              {blockers.length === 1 ? 'Finish this before continuing:' : 'Finish these before continuing:'}
            </span>
            <ul>
              {blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </div>
      )}
      <div className={styles.bar}>
        <Button type="button" variant="secondary" onClick={onPrev} disabled={submitting}>
          <ArrowLeft size={14} strokeWidth={1.75} />
          {isFirst ? 'Back to cart' : 'Previous'}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={hardDisabled}
          aria-disabled={muted}
          className={muted ? styles.muted : undefined}
          onClick={handlePrimary}
        >
          {submitting ? 'Placing order…' : primaryLabel}
          {!submitting && (isSignStep
            ? <Check size={14} strokeWidth={2} />
            : <ArrowRight size={14} strokeWidth={1.75} />)}
        </Button>
      </div>
    </div>
  );
};
