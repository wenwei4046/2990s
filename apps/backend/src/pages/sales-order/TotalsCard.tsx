// ----------------------------------------------------------------------------
// TotalsCard — Revenue / Cost / Margin / Margin% KPI tiles + per-category
// breakdown. Extracted from SalesOrderDetail.tsx (task #61).
//
// React.memo'd: only re-renders when the header reference changes (after
// a save). Line item edits + history-drawer toggles no longer touch it.
// ----------------------------------------------------------------------------

import { memo } from 'react';
import type { SoHeader } from './types';
import { fmtRm, TOTALS_KPI_GRID_STYLE, TOTALS_KPI_VALUE_STYLE } from './types';
import styles from '../SalesOrderDetail.module.css';

export const TotalsCard = memo(({ header }: { header: SoHeader }) => {
  // margin_pct_basis is margin/revenue × 10000. Divide by 100 to get %.
  const marginPct = header.margin_pct_basis / 100;
  const marginCls =
    header.total_margin_centi <= 0 ? styles.marginBad
    : marginPct >= 30 ? styles.marginGood
    : marginPct >= 15 ? styles.marginWarn
    : styles.marginBad;

  /* Task #114 — Per-category rows. */
  const categories: Array<{ label: string; rev: number; cost: number }> = [
    { label: 'Mattress / Sofa', rev: header.mattress_sofa_centi, cost: header.mattress_sofa_cost_centi ?? 0 },
    { label: 'Bedframe',        rev: header.bedframe_centi,      cost: header.bedframe_cost_centi      ?? 0 },
    { label: 'Accessories',     rev: header.accessories_centi,   cost: header.accessories_cost_centi   ?? 0 },
    { label: 'Others',          rev: header.others_centi,        cost: header.others_cost_centi        ?? 0 },
  ];

  const fmtMarginClass = (rev: number, marginCenti: number) => {
    if (rev <= 0) return styles.muted;
    if (marginCenti > 0) return styles.marginGood;
    if (marginCenti < 0) return styles.marginBad;
    return styles.muted;
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Totals · Margin</h2>
      </header>
      <div className={styles.cardBody}>
        <div style={TOTALS_KPI_GRID_STYLE}>
          <div>
            <div className={styles.totalLabel}>Revenue</div>
            <div className={styles.grandTotal} style={TOTALS_KPI_VALUE_STYLE}>
              {fmtRm(header.local_total_centi, header.currency)}
            </div>
          </div>
          <div>
            <div className={styles.totalLabel}>Cost</div>
            <div className={styles.totalValue} style={TOTALS_KPI_VALUE_STYLE}>
              {fmtRm(header.total_cost_centi, header.currency)}
            </div>
          </div>
          <div>
            <div className={styles.totalLabel}>Margin</div>
            <div className={`${styles.totalValue} ${marginCls}`} style={TOTALS_KPI_VALUE_STYLE}>
              {fmtRm(header.total_margin_centi, header.currency)}
            </div>
          </div>
          <div>
            <div className={styles.totalLabel}>Margin %</div>
            <div className={`${styles.totalValue} ${marginCls}`} style={TOTALS_KPI_VALUE_STYLE}>
              {header.local_total_centi > 0 ? `${marginPct.toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>

        <div className={styles.totalLabel} style={{ marginBottom: 'var(--space-2)' }}>
          By Category
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {categories.map(({ label, rev, cost }) => {
            const margin = rev - cost;
            return (
              <div key={label} style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
                gap: 'var(--space-3)',
                alignItems: 'baseline',
              }}>
                <div className={styles.totalLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'var(--fs-13)' }}>
                  {label}
                </div>
                <div className={styles.totalValue}>
                  Revenue {fmtRm(rev, header.currency)}
                </div>
                <div className={styles.totalValue} style={{ color: 'var(--fg-muted)' }}>
                  Cost {fmtRm(cost, header.currency)}
                </div>
                <div className={`${styles.totalValue} ${fmtMarginClass(rev, margin)}`}>
                  Margin {fmtRm(margin, header.currency)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});
TotalsCard.displayName = 'TotalsCard';
