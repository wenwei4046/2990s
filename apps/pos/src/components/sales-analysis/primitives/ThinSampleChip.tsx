import { fmtQty } from '@2990s/shared';
import styles from '../SaShared.module.css';

/** Amber pill flagging a thin sample (n < MIN_SAMPLE). Replaces the old
 *  free-floating "directional only" paragraphs — same caution, consistent
 *  placement, no layout jumps. */
export const ThinSampleChip = ({ n }: { n: number }) => (
  <span className={styles.thinChip}>n = {fmtQty(n)} · directional</span>
);
