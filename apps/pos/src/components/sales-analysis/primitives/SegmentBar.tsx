import { fmtQty } from '@2990s/shared';
import styles from '../SaShared.module.css';

interface Bucket {
  key: string;
  count: number;
}

interface SegmentBarProps {
  /** Pre-ordered via orderBuckets (or pre-sorted category mix). */
  buckets: Bucket[];
  /** (k) => entityColor(dim, k). */
  colorOf: (key: string) => string;
  legend?: 'rows' | 'inline' | 'none';
  /** Legend right value; default `${fmtQty(count)} (${pct}%)`.
   *  (Spec names this `valueOf`, but that collides with
   *  `Object.prototype.valueOf` in TS structural checks at call sites that
   *  omit it — renamed to `formatValue`.) */
  formatValue?: (b: Bucket) => string;
  height?: number;
  /** Dimension name, e.g. 'Gender' — used for the computed aria-label. */
  ariaLabel: string;
}

/** 100%-stacked segment bar for low-cardinality dims (race, gender,
 *  new/returning, category). Never text inside a segment; never used for
 *  city/state/age. No mount or transition animation — calm > clever. */
export const SegmentBar = ({
  buckets,
  colorOf,
  legend = 'rows',
  formatValue,
  height = 12,
  ariaLabel,
}: SegmentBarProps) => {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const pctOf = (count: number): number => (total > 0 ? Math.round((count / total) * 100) : 0);
  const valueText = formatValue ?? ((b: Bucket) => `${fmtQty(b.count)} (${pctOf(b.count)}%)`);
  const label = `${ariaLabel}: ${buckets.map((b) => `${b.key} ${pctOf(b.count)}%`).join(', ')}`;

  return (
    <div role="img" aria-label={label}>
      <div className={styles.segBar} style={{ height, borderRadius: height / 2 }}>
        {total > 0 &&
          buckets.map((b) => (
            <span
              key={b.key}
              className={styles.segSeg}
              style={{ flexGrow: b.count, background: colorOf(b.key) }}
            />
          ))}
      </div>
      {legend === 'rows' && (
        <div className={styles.legendRows}>
          {buckets.map((b) => (
            <div key={b.key} className={styles.legendRow}>
              <span className={styles.dot} style={{ background: colorOf(b.key) }} />
              <span className={styles.legendKey}>{b.key}</span>
              <span className={styles.legendVal}>{valueText(b)}</span>
            </div>
          ))}
        </div>
      )}
      {legend === 'inline' && (
        <div className={styles.legendInline}>
          {buckets.map((b) => (
            <span key={b.key} className={styles.legendInlineItem}>
              <span className={styles.dot} style={{ background: colorOf(b.key) }} />
              {b.key} {pctOf(b.count)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
