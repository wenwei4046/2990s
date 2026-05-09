import styles from './LaneStepper.module.css';

const LANES = [
  { id: 'received',    num: '01', label: 'Received',   enabled: true },
  { id: 'proceed',     num: '02', label: 'Proceed',    enabled: true },
  { id: 'logistics',   num: '03', label: 'Logistics',  enabled: true },
  { id: 'ready',       num: '04', label: 'Ready',      enabled: true },
  { id: 'dispatched',  num: '05', label: 'Dispatched', enabled: false, tip: 'Driver assignment coming next iteration' },
  { id: 'delivered',   num: '06', label: 'Delivered',  enabled: false, tip: 'Driver assignment coming next iteration' },
] as const;

export type Lane = (typeof LANES)[number]['id'];

interface Props {
  current: Lane;
  onAdvance: (next: Lane) => void;
  busy?: boolean;
}

export function LaneStepper({ current, onAdvance, busy = false }: Props) {
  const currentIdx = LANES.findIndex((l) => l.id === current);

  return (
    <ol className={styles.row}>
      {LANES.map((lane, i) => {
        const isCurrent = lane.id === current;
        const isPast = i < currentIdx;
        // Allow click on any active lane that's NOT the current one,
        // forward or backward (coordinator can correct mistakes).
        const isClickable = lane.enabled && !isCurrent && !busy;
        const className = [
          styles.step,
          isCurrent ? styles.current : '',
          isPast ? styles.past : '',
          !lane.enabled ? styles.disabled : '',
        ].filter(Boolean).join(' ');
        const tip = 'tip' in lane ? lane.tip : '';
        return (
          <li key={lane.id} className={className} title={tip}>
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onAdvance(lane.id)}
            >
              <span className={styles.num}>{lane.num}</span>
              <span className={styles.label}>{lane.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
