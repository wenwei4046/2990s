import type { ReactNode } from 'react';
import styles from '../SaShared.module.css';

interface StatTileProps {
  label: string;
  value: string;
  sub?: string;
  chip?: ReactNode;
}

/** KPI tile. Value uses proportional figures on purpose — tabular-nums is for
 *  tables only. `chip` renders inline after the label (e.g. ThinSampleChip). */
export const StatTile = ({ label, value, sub, chip }: StatTileProps) => (
  <div className={styles.statTile}>
    <div className={styles.statLabelRow}>
      <span className={styles.statLabel}>{label}</span>
      {chip}
    </div>
    <span className={styles.statValue}>{value}</span>
    {sub != null && <span className={styles.statSub}>{sub}</span>}
  </div>
);
