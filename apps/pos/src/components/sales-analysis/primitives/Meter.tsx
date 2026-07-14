import styles from '../SaShared.module.css';

interface MeterProps {
  value: number;
  max: number;
  /** Track width; number = px. Default 64. (Accepts '100%' for cell-filling meters.) */
  width?: number | string;
}

/** Inline proportional garnish next to a printed number in ranked tables.
 *  Never the only encoding — the number is always printed beside it. */
export const Meter = ({ value, max, width = 64 }: MeterProps) => {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className={styles.meterTrack} style={{ width }} aria-hidden="true">
      {max > 0 && value > 0 && (
        <span className={styles.meterFill} style={{ width: `${pct}%`, minWidth: 2 }} />
      )}
    </span>
  );
};
