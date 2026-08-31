// SummaryCard — one headline figure and the parts it is made of.
//
// Ported from the OPEX & Commission tab (components/opex/SummaryCard.tsx),
// which Loo signed off on 2026-08-31 after rejecting a flat grid of equal-sized
// tiles ("太千篇一律，没有层次感了"). Sales Analysis carried the same flaw and now
// carries the same fix. See the SummaryCard block in SaShared.module.css for
// the reasoning; this file is the mechanics.
//
// Deliberately a SEPARATE component from the Opex one rather than a shared
// import: that one formats sen through commission-format and styles from
// Opex.module.css, and coupling a payroll screen to an analytics screen so that
// a tweak to one silently reshapes the other is not a trade worth making for
// ~60 lines. The pattern is shared; the code is not.
//
// ── WHEN A PART CANNOT BE SHOWN ──────────────────────────────────────────────
// Any part can legitimately be unknown here — Houzs's gateSaFinance deletes
// every margin path for a non-finance caller. A part with no value renders "—"
// and is LEFT OUT of the bar rather than drawn as zero: a zero-width segment
// reads as "there was none of this", which is a different statement from "you
// may not see this". When the split is incomplete the bar does not render at
// all instead of drawing a misleading one.

import type { ReactNode } from 'react';
import { fmtCenti } from '@2990s/shared';
import styles from '../SaShared.module.css';

export interface SummaryPart {
  label: string;
  /** null = not known. Renders "—" and is excluded from the bar. */
  centi: number | null;
  hint?: string;
  /** Any CSS colour — pass an --sa-* var or an entityColor() hex. */
  color: string;
}

export interface SummaryCardProps {
  eyebrow: string;
  headlineLabel: string;
  /** null = not known; the card still renders its parts. */
  headlineCenti: number | null;
  headlineHint: string;
  parts: SummaryPart[];
  /** Marks the card carrying the number the page is really about. */
  emphasis?: boolean;
  /** Optional footer, e.g. a link into the tab that owns the detail. */
  footer?: ReactNode;
}

export const SummaryCard = ({
  eyebrow, headlineLabel, headlineCenti, headlineHint, parts, emphasis, footer,
}: SummaryCardProps) => {
  const money = (v: number | null): string => (v === null ? '—' : fmtCenti(v));

  /* The bar is drawn from the parts, not from the headline: they are what it is
     a picture OF, and any of them can be missing. */
  const known = parts.filter(
    (p): p is SummaryPart & { centi: number } => p.centi !== null && p.centi > 0,
  );
  const barTotal = known.reduce((s, p) => s + p.centi, 0);
  const complete = parts.every((p) => p.centi !== null);
  const showBar = complete && barTotal > 0;

  const share = (centi: number | null): string => {
    if (!complete || barTotal <= 0 || centi === null) return '';
    const pct = (centi / barTotal) * 100;
    /* "<0.1%" rather than "0.0%": a slice that exists but rounds to nothing is
       not the same as one that is not there. */
    return pct > 0 && pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`;
  };

  return (
    <section className={`${styles.summary} ${emphasis ? styles.summaryLead : ''}`}>
      <div className={styles.summaryEyebrow}>{eyebrow}</div>

      <div className={styles.summaryHead}>
        <span className={styles.summaryHeadLabel}>{headlineLabel}</span>
        <span className={styles.summaryHeadValue}>{money(headlineCenti)}</span>
        <span className={styles.summaryHeadHint}>{headlineHint}</span>
      </div>

      {showBar && (
        <div className={styles.summaryBar} aria-hidden="true">
          {known.map((p) => (
            <span
              key={p.label}
              className={styles.summaryBarSeg}
              style={{ flexGrow: p.centi, background: p.color }}
            />
          ))}
        </div>
      )}

      <ul className={styles.partList}>
        {parts.map((p) => (
          <li key={p.label} className={styles.part}>
            <span className={styles.partDot} style={{ background: p.color }} />
            <span className={styles.partLabel}>
              {p.label}
              {p.hint != null && <span className={styles.partHint}>{p.hint}</span>}
            </span>
            <span className={styles.partShare}>{share(p.centi)}</span>
            <span className={styles.partValue}>{money(p.centi)}</span>
          </li>
        ))}
      </ul>

      {footer}
    </section>
  );
};
