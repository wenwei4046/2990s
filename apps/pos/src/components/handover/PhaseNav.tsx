import { Check, User, MapPin, ShieldAlert, Calendar, Package, Banknote, PenLine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from './PhaseNav.module.css';

interface StepDef {
  phase: 1 | 2;
  key: string;
  label: string;
}

const ICON: Record<string, LucideIcon> = {
  customer: User,
  address: MapPin,
  emergency: ShieldAlert,
  target: Calendar,
  addons: Package,
  confirm: Banknote,
  sign: PenLine,
};

export const PhaseNav = ({
  phase, steps, currentIdx, onJump,
}: {
  phase: 1 | 2;
  steps: readonly StepDef[];
  currentIdx: number;
  onJump: (targetIdx: number) => void;
}) => {
  const phaseSteps = steps
    .map((s, i) => ({ step: s, idx: i }))
    .filter(({ step }) => step.phase === phase);

  return (
    <ol className={styles.chips}>
      {phaseSteps.map(({ step, idx: i }, position) => {
        const isCurrent = i === currentIdx;
        const isPast = i < currentIdx;
        const Icon = ICON[step.key] ?? User;
        const stateClass =
          isCurrent ? styles.chipCurrent :
          isPast    ? styles.chipPast :
                      '';
        const numClass =
          isCurrent ? styles.chipNumCurrent :
          isPast    ? styles.chipNumPast :
                      '';
        return (
          <li
            key={step.key}
            className={`${styles.chip} ${stateClass}`}
          >
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => { if (isPast) onJump(i); }}
              disabled={!isPast}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className={`${styles.chipNum} ${numClass}`}>
                {isPast ? <Check size={14} strokeWidth={2.25} /> : position + 1}
              </span>
              <span className={styles.chipLabel}>
                <Icon size={14} strokeWidth={1.75} />
                {step.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
};
