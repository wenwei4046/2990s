// ----------------------------------------------------------------------------
// The period summary — one headline figure and the parts it is made of.
//
// Loo 2026-08-31: "太千篇一律，没有层次感了". It was eight identically-sized
// boxes in two rows, which said every number carried the same weight. They do
// not, and worse, the flat grid hid the one thing that makes them readable:
//
//     Products + Service + KPI item  =  Total revenue
//     Commission + Override + KPI earned  =  Total payout
//
// Both strips are PART-TO-WHOLE. So each is now one card: the total as the
// headline, a proportion bar, and the three parts underneath — quieter, with
// their share. The relationship is now the layout rather than something a
// reader has to work out with a calculator.
//
// The bar is a thin rule, not a filled block — the brand is flat and paper-like
// (UI_REFERENCE "What NOT to do"), and orange stays an accent: it marks the
// SMALLEST part, the KPI slice, which is the one that most often needs
// attention.
//
// ── WHEN A PART CANNOT BE SHOWN ─────────────────────────────────────────────
// The revenue split is derived, so any of it can legitimately be unknown (a
// reader without the finance columns, a reconciliation failure). A part with no
// value renders "—" and is LEFT OUT of the bar rather than drawn as zero —
// a zero-width segment reads as "sold none of this", which is a different
// statement. When the whole split is unavailable the bar does not render at all
// instead of drawing a misleading one.
// ----------------------------------------------------------------------------

import { fmtSen } from '../../lib/commission-format';
import styles from './Opex.module.css';

export interface SummaryPart {
  label: string;
  /** null = not known. Renders "—" and is excluded from the bar. */
  centi: number | null;
  hint: string;
  /** Which of the three tones this slice takes. */
  tone: 'a' | 'b' | 'c';
}

export interface SummaryCardProps {
  eyebrow: string;
  headlineLabel: string;
  /** null = not known; the card still renders its parts. */
  headlineCenti: number | null;
  headlineHint: string;
  parts: SummaryPart[];
  /** "…" instead of "—" while the figures are still arriving — a payroll screen
   *  must not show "loading" and "cannot be derived" as the same thing. */
  loading?: boolean;
  /** Marks the card carrying the number that actually gets paid. */
  emphasis?: boolean;
}

export const SummaryCard = ({
  eyebrow, headlineLabel, headlineCenti, headlineHint, parts, loading, emphasis,
}: SummaryCardProps) => {
  const money = (v: number | null) => (loading ? '…' : v === null ? '—' : fmtSen(v));

  /* The bar is drawn from the parts, not from the headline: they are what it
     is a picture OF, and any of them can be missing. */
  const known = parts.filter((p) => p.centi !== null && p.centi > 0) as Array<SummaryPart & { centi: number }>;
  const barTotal = known.reduce((s, p) => s + p.centi, 0);
  const complete = !loading && parts.every((p) => p.centi !== null);
  const showBar = complete && barTotal > 0;

  const share = (centi: number | null): string | null => {
    if (!complete || barTotal <= 0 || centi === null) return null;
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
        <div className={styles.bar} aria-hidden="true">
          {known.map((p) => (
            <span
              key={p.label}
              className={`${styles.barSeg} ${styles[`tone${p.tone.toUpperCase()}`]}`}
              style={{ flexGrow: p.centi }}
            />
          ))}
        </div>
      )}

      <ul className={styles.partList}>
        {parts.map((p) => (
          <li key={p.label} className={styles.part}>
            <span className={`${styles.partDot} ${styles[`tone${p.tone.toUpperCase()}`]}`} />
            <span className={styles.partLabel}>
              {p.label}
              <span className={styles.partHint}>{p.hint}</span>
            </span>
            <span className={styles.partShare}>{share(p.centi) ?? ''}</span>
            <span className={styles.partValue}>{money(p.centi)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};
