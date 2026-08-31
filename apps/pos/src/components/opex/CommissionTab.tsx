// ----------------------------------------------------------------------------
// OPEX ▸ Commission — what each salesperson sold, and what it pays them.
//
// Every PAYOUT figure is computed SERVER-SIDE by the one commission engine
// (Houzs scm/shared/hr-commission.ts) over the Sales Orders the POS itself
// wrote. Nothing here re-derives a payout: this component formats and arranges.
// A second implementation of that arithmetic is how a report and a payslip stop
// agreeing.
//
// The REVENUE half — Products / Service / KPI item / Total, the four Loo named
// on 2026-08-31 — is folded in the POS from the SO headers for the same range
// (lib/commission-revenue.ts), because the engine does not report it and he
// asked for this to stay POS-side. It is built AROUND the engine's own figure,
// never over it: `Products` IS `personalGoodsCenti`, so the number under the
// percentage is always the number the percentage ran on. The other two are
// derived from it and are dropped, loudly, if they fail to reconcile.
//
// TWO STATES A RANGE CAN BE IN, and the difference matters:
//   · OPEN   — recomputed live from TODAY's rates on every load. Edit a rate and
//              this range's figures move.
//   · CLOSED — frozen. The rows are served from the snapshot taken at close, so
//              a later rate edit cannot rewrite a payout somebody has approved.
// The banner says which, because "why did last month change?" is otherwise
// unanswerable.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, Lock, LockOpen, RefreshCw,
} from 'lucide-react';
import { fmtDate } from '@2990s/shared';
import { useClosePayout, useReopenPayout } from '../../lib/commission-api';
import {
  useCommissionReport, type CommissionReport, type CommissionReportRow,
} from '../../lib/commission-engine';
import { useCommissionRevenue } from '../../lib/commission-revenue-queries';
import { splitForRow, type RevenueSplit, type SalespersonRevenue } from '../../lib/commission-revenue';
import { hrErrorMessage } from '../../lib/hr-wire';
import { fmtBps, fmtSen } from '../../lib/commission-format';
import { SummaryCard } from './SummaryCard';
import styles from './Opex.module.css';

/** First and last day of the CURRENT Malaysian month, as ISO dates.
 *  Derived from the MY-shifted clock so a report opened at 1 a.m. on the 1st in
 *  UTC+8 does not default to last month. */
const currentMonthRange = (): { from: string; to: string } => {
  const my = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const y = my.getUTCFullYear();
  const m = my.getUTCMonth();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: iso(new Date(Date.UTC(y, m, 1))),
    // Day 0 of the next month is the last day of this one.
    to: iso(new Date(Date.UTC(y, m + 1, 0))),
  };
};

interface Totals {
  /* revenue — what was sold */
  productsCenti: number;
  serviceCenti: number;
  kpiRevenueCenti: number;
  totalRevenueCenti: number;
  /* False as soon as ONE person's figure is missing: a column that is the sum of
     some-but-not-all rows is worse than no column. Split in two because the two
     halves fail INDEPENDENTLY — a caller who may not see the per-category
     columns still gets every order's total, so Total revenue survives while
     Service and KPI item do not. */
  splitComplete: boolean;
  totalComplete: boolean;
  /* payout — what is paid */
  commissionCenti: number;
  overrideCenti: number;
  kpiEarnedCenti: number;
  payoutCenti: number;
  people: number;
  mismatches: number;
}

const sumReport = (
  report: CommissionReport,
  splits: Map<string, RevenueSplit>,
): Totals => {
  const t: Totals = {
    productsCenti: 0, serviceCenti: 0, kpiRevenueCenti: 0, totalRevenueCenti: 0,
    splitComplete: true, totalComplete: true,
    commissionCenti: 0, overrideCenti: 0, kpiEarnedCenti: 0, payoutCenti: 0, people: 0, mismatches: 0,
  };
  for (const s of report.showrooms) {
    for (const r of s.rows) {
      t.productsCenti += r.personalGoodsCenti;
      t.commissionCenti += r.personalCommissionCenti;
      t.overrideCenti += r.overrideCommissionCenti;
      t.kpiEarnedCenti += r.itemKpiCenti;
      t.payoutCenti += r.totalCenti;
      t.people += 1;

      const sp = splits.get(r.staffId);
      if (sp && sp.serviceCenti !== null && sp.kpiCenti !== null) {
        t.serviceCenti += sp.serviceCenti;
        t.kpiRevenueCenti += sp.kpiCenti;
      } else {
        t.splitComplete = false;
      }
      if (sp && sp.totalCenti !== null) t.totalRevenueCenti += sp.totalCenti;
      else t.totalComplete = false;
      if (sp?.mismatch) t.mismatches += 1;
    }
  }
  return t;
};

export const CommissionTab = ({ canManage }: { canManage: boolean }) => {
  const [draft, setDraft] = useState(currentMonthRange);
  /* The APPLIED range, not the live fields: the query key is the gate, and a
     multi-table payroll read must not re-run on every keystroke. */
  const [applied, setApplied] = useState(currentMonthRange);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const { report: data, closed, isLoading, error } = useCommissionReport(applied.from, applied.to);
  /* The revenue fold runs beside the report over the SAME range. It is
     supplementary: if it fails, the payout half still renders in full. */
  const revenue = useCommissionRevenue(applied.from, applied.to);
  const closePayout = useClosePayout();
  const reopenPayout = useReopenPayout();

  /* One split per person, built once. `byStaff` may be absent (still loading, or
     the fold failed) — splitForRow then reports what it can. */
  const splits = useMemo(() => {
    const m = new Map<string, RevenueSplit>();
    if (!data) return m;
    const by: Map<string, SalespersonRevenue> | undefined = revenue.data?.byStaff;
    for (const s of data.showrooms) {
      for (const r of s.rows) {
        m.set(r.staffId, splitForRow(r.personalGoodsCenti, by?.get(r.staffId)));
      }
    }
    return m;
  }, [data, revenue.data]);

  const totals = useMemo(() => (data ? sumReport(data, splits) : null), [data, splits]);
  const rangeInvalid = draft.from > draft.to;
  const revenueLoading = revenue.isLoading || revenue.isFetching;

  const runClose = async () => {
    setActionError(null);
    try {
      if (!data) return;
      /* The rows are sent WITH the close: commission is computed here, so what
         is frozen is a record of what the approver was looking at. Sending a
         bare range would leave the server to recompute from inputs it cannot
         read. */
      await closePayout.mutateAsync({
        from: applied.from, to: applied.to,
        totalCenti: data.totalCenti,
        rows: data.showrooms.flatMap((sr) =>
          sr.rows.map((r) => ({ ...r, showroomId: sr.showroomId, showroomName: sr.showroomName }))),
      });
    } catch (e) {
      setActionError(hrErrorMessage(e));
    }
  };

  const runReopen = async () => {
    setActionError(null);
    /* A reopen needs a stated reason — the server requires one, and it is what
       later explains why an approved figure was allowed to move. */
    const reason = window.prompt(
      'Reopening a closed period lets its figures change again. Why is it being reopened?',
    );
    if (!reason || !reason.trim()) return;
    try {
      await reopenPayout.mutateAsync({ from: applied.from, to: applied.to, reason: reason.trim() });
    } catch (e) {
      setActionError(hrErrorMessage(e));
    }
  };

  return (
    <div className={styles.stack}>
      {/* ── range picker ───────────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>From (SO date)</span>
            <input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>To (SO date, inclusive)</span>
            <input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
          <div className={styles.field}>
            <span className={styles.label}>&nbsp;</span>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                disabled={rangeInvalid || isLoading}
                onClick={() => { setActionError(null); setApplied(draft); }}
              >
                <RefreshCw size={16} strokeWidth={1.75} />
                {isLoading ? 'Calculating…' : 'Calculate'}
              </button>
            </div>
          </div>
        </div>
        {rangeInvalid && (
          <p className={styles.error}>The From date is after the To date, so the range is empty.</p>
        )}
        <p className={styles.cardHint}>
          Orders are counted by <strong>SO date</strong>. Cancelled, on-hold and draft orders earn
          nothing and are left out of every figure below — which is why these totals do not match
          the My orders cards, where a draft counts as pipeline.
        </p>
      </div>

      {isLoading && <p className={styles.muted}>Loading…</p>}
      {error && <p className={styles.error}>{hrErrorMessage(error)}</p>}
      {actionError && <p className={styles.error}>{actionError}</p>}

      {data && totals && (
        <>
          {/* ── period lock ─────────────────────────────────────────────── */}
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>
                {closed ? <Lock size={16} strokeWidth={1.75} /> : <LockOpen size={16} strokeWidth={1.75} />}
                {fmtDate(data.from)} – {fmtDate(data.to)}
              </h2>
              <span className={`${styles.chip} ${closed ? styles.chipLocked : ''}`}>
                {closed ? `Closed · revision ${closed.revision}` : 'Open · recalculates live'}
              </span>
            </div>
            <p className={styles.cardHint}>
              {closed ? (
                <>
                  These figures are frozen as they stood when the period was closed
                  {closed.closedByName ? ` by ${closed.closedByName}` : ''}
                  {closed.closedAt ? ` on ${fmtDate(closed.closedAt)}` : ''}. Changing a rate
                  now will not move them.
                </>
              ) : (
                <>
                  This period is open, so it is recalculated from the current rates every time it is
                  loaded — editing a rate in Setup will change these figures. Close the period once
                  the payout is approved.
                </>
              )}
            </p>
            {canManage && (
              <div className={styles.actions}>
                {closed ? (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={reopenPayout.isPending}
                    onClick={() => void runReopen()}
                  >
                    <LockOpen size={16} strokeWidth={1.75} /> Reopen period
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.btn}
                    disabled={closePayout.isPending || totals.people === 0}
                    onClick={() => void runClose()}
                  >
                    <Lock size={16} strokeWidth={1.75} /> Close period
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Everything the engine could not read, said out loud. It reports a
              reason rather than shading a figure, so each of these is a
              sentence a person can act on — an unresolved fabric add-on, a
              range too wide to read, a chain mode with no ladder. */}
          {data.warnings.map((w) => (
            <p key={w} className={styles.error}>{w}</p>
          ))}

          {/* Two part-to-whole cards, not eight equal tiles (Loo 2026-08-31:
              "太千篇一律，没有层次感了"). Each carries its total as the
              headline and the parts underneath, so the arithmetic that relates
              them is visible instead of implied. */}
          <div className={styles.summaryRow}>
            <SummaryCard
              eyebrow="Revenue — what was sold"
              headlineLabel="Total revenue"
              headlineCenti={totals.totalComplete ? totals.totalRevenueCenti : null}
              headlineHint="products + service + KPI items"
              loading={revenueLoading}
              parts={[
                {
                  label: 'Products sales revenue', tone: 'a',
                  centi: totals.productsCenti,
                  hint: 'the base commission is paid on',
                },
                {
                  label: 'Service sales revenue', tone: 'b',
                  centi: totals.splitComplete ? totals.serviceCenti : null,
                  hint: 'delivery + service lines · earns no commission',
                },
                {
                  label: 'KPI item sales revenue', tone: 'c',
                  centi: totals.splitComplete ? totals.kpiRevenueCenti : null,
                  hint: 'paid as a fixed amount, not a %',
                },
              ]}
            />

            <SummaryCard
              eyebrow="Commission — what it pays"
              headlineLabel="Total payout"
              headlineCenti={totals.payoutCenti}
              headlineHint={`${totals.people} ${totals.people === 1 ? 'salesperson' : 'salespeople'}`}
              emphasis
              parts={[
                {
                  label: 'Revenue commission', tone: 'a',
                  centi: totals.commissionCenti,
                  hint: 'tiered % of product sales',
                },
                {
                  label: 'Manager override', tone: 'b',
                  centi: totals.overrideCenti,
                  hint: data.config.overrideMode === 'chain' ? 'reporting chain' : 'whole showroom',
                },
                {
                  label: 'KPI items earned', tone: 'c',
                  centi: totals.kpiEarnedCenti,
                  hint: 'fixed amounts, not a %',
                },
              ]}
            />
          </div>

          {/* The revenue half is folded in the POS from a SECOND query, so it can
              disagree with the engine's own order set. It is never allowed to do
              so quietly — see lib/commission-revenue.ts. */}
          {revenue.error && (
            <p className={styles.error}>
              The revenue split could not be loaded ({hrErrorMessage(revenue.error)}). Every
              commission figure below is unaffected — those come from the server.
            </p>
          )}
          {!revenueLoading && totals.mismatches > 0 && (
            <p className={styles.error}>
              <strong>Revenue split unavailable for {totals.mismatches} of {totals.people}.</strong>{' '}
              Their sales orders do not reconcile with what the commission engine counted — usually
              because this account can only see part of the sales book. Commission, override and KPI
              amounts are unaffected: those are the server&rsquo;s own figures. Ask an account with
              full sales visibility to read the revenue split.
            </p>
          )}
          {revenue.data?.truncated && (
            <p className={styles.error}>
              This range holds more orders than the revenue split can read in one go, so the revenue
              figures are incomplete. Narrow the range — a payout period is normally one month.
            </p>
          )}

          {/* ── per showroom ────────────────────────────────────────────── */}
          {data.showrooms.length === 0 && (
            <div className={styles.card}>
              <p className={styles.muted}>
                — No salesperson is on the commission scheme yet.
              </p>
              <p className={styles.cardHint}>
                A person earns nothing here until they are added under
                <strong> Setup ▸ Salespeople</strong>. Their orders are also left out of their
                showroom&rsquo;s total, so register everyone who should earn before reading a period.
              </p>
            </div>
          )}

          {data.showrooms.map((sr) => (
            <div key={sr.showroomId} className={styles.card}>
              <div className={styles.showroomHead}>
                <h2 className={styles.showroomName}>{sr.showroomName}</h2>
                <span className={styles.showroomMeta}>
                  Showroom product sales <strong>{fmtSen(sr.showroomGoodsCenti)}</strong>
                  <span className={`${styles.chip} ${sr.showroomKpiHit ? styles.chipHit : styles.chipOff}`}>
                    {sr.showroomKpiHit ? 'Showroom target reached' : 'Showroom target not reached'}
                  </span>
                </span>
              </div>

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    {/* Grouped header: the four revenue columns and the four
                        payout columns answer different questions, and "KPI item"
                        appears in both — as revenue on one side, as the fixed
                        amount earned on the other. */}
                    <tr>
                      <th colSpan={2} />
                      <th className={styles.groupHead} colSpan={4}>Revenue — sold</th>
                      <th className={`${styles.groupHead} ${styles.groupStart}`} colSpan={5}>
                        Commission — paid
                      </th>
                    </tr>
                    <tr>
                      <th>Salesperson</th>
                      <th>Level</th>
                      <th className={styles.num}>Products</th>
                      <th className={styles.num}>Service</th>
                      <th className={styles.num}>KPI item</th>
                      <th className={styles.num}>Total</th>
                      <th className={`${styles.num} ${styles.groupStart}`}>Rate</th>
                      <th className={styles.num}>Revenue comm.</th>
                      <th className={styles.num}>Override</th>
                      <th className={styles.num}>KPI earned</th>
                      <th className={styles.num}>Total pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sr.rows.map((r) => (
                      <PersonRows
                        key={r.staffId}
                        row={r}
                        split={splits.get(r.staffId)}
                        revenueLoading={revenueLoading}
                        expanded={!!open[r.staffId]}
                        onToggle={() => setOpen((o) => ({ ...o, [r.staffId]: !o[r.staffId] }))}
                      />
                    ))}
                    {sr.rows.length === 0 && (
                      <tr className={styles.rowMuted}>
                        <td colSpan={11}>— Nobody on the scheme is assigned to this showroom.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* What the numbers mean. Stated on the screen rather than in a
              handover note, because the single most expensive question about a
              commission report is "does this figure include the fabric
              upgrade?" */}
          <p className={styles.notice}>
            <span className={styles.noticeTitle}>
              <AlertTriangle size={14} strokeWidth={1.75} /> How the revenue is split
            </span>
            <br />
            <strong>Products</strong> is what the percentage is paid on. It excludes delivery and
            every service line, and it excludes the add-on amount of anything that earned a KPI item
            — a flagged fabric upgrade pays its fixed amount <em>instead of</em> a percentage, never
            both. <strong>Service</strong> is delivery plus every service line, and earns no
            commission. <strong>KPI item</strong> is the revenue those flags removed; the fixed
            amounts it earns are in the <strong>KPI earned</strong> column. The three add up to
            <strong> Total revenue</strong>.
            <br />
            Products, rate, commission, override and KPI earned come from the commission engine.
            Service, KPI item and Total are folded here in the POS from the same orders, and are
            hidden rather than shown if they fail to reconcile with it.
          </p>
        </>
      )}
    </div>
  );
};

/** One salesperson: the figures row, plus the breakdown when expanded. */
const PersonRows = ({
  row, split, revenueLoading, expanded, onToggle,
}: {
  row: CommissionReportRow;
  split: RevenueSplit | undefined;
  revenueLoading: boolean;
  expanded: boolean;
  onToggle: () => void;
}) => {
  const hasDetail = row.kpiDetail.length > 0 || (row.overrideDetail?.length ?? 0) > 0;
  /* "…" while the fold is in flight, "—" when it genuinely cannot be derived.
     A payroll screen must not show the two as the same thing. */
  const money = (v: number | null | undefined) =>
    revenueLoading ? '…' : v === null || v === undefined ? '—' : fmtSen(v);

  return (
    <>
      <tr>
        <td>
          {hasDetail ? (
            <button type="button" className={styles.iconBtn} onClick={onToggle} aria-expanded={expanded}>
              {expanded
                ? <ChevronDown size={16} strokeWidth={1.75} />
                : <ChevronRight size={16} strokeWidth={1.75} />}
            </button>
          ) : null}
          {row.staffName || <span className={styles.code}>{row.staffId}</span>}
          {split?.mismatch && !revenueLoading && (
            <> <span className={styles.chip} title="Sales orders do not reconcile with the engine">
              revenue n/a
            </span></>
          )}
        </td>
        <td>{row.tier === 'manager' ? 'Manager' : 'Sales'}</td>

        <td className={styles.num}>{fmtSen(row.personalGoodsCenti)}</td>
        <td className={styles.num}>{money(split?.serviceCenti)}</td>
        <td className={styles.num}>{money(split?.kpiCenti)}</td>
        <td className={styles.num}>{money(split?.totalCenti)}</td>

        <td className={`${styles.num} ${styles.groupStart}`}>{fmtBps(row.personalRateBps)}</td>
        <td className={styles.num}>{fmtSen(row.personalCommissionCenti)}</td>
        <td className={styles.num}>
          {row.overrideCommissionCenti === 0 && row.tier !== 'manager'
            ? '—'
            : fmtSen(row.overrideCommissionCenti)}
          {/* A single override rate exists only in showroom mode; in chain mode
              the override is a sum over levels of different rates on different
              bases, so printing a blended one would be a figure nobody can
              reconcile against a payslip. */}
          {row.overrideRateBps !== null && row.overrideRateBps > 0 && (
            <span className={styles.tileHint}> · {fmtBps(row.overrideRateBps)}</span>
          )}
        </td>
        <td className={styles.num}>{row.itemKpiCenti === 0 ? '—' : fmtSen(row.itemKpiCenti)}</td>
        <td className={`${styles.num} ${styles.payCell}`}>{fmtSen(row.totalCenti)}</td>
      </tr>

      {expanded && hasDetail && (
        <tr>
          <td className={styles.detailCell} colSpan={11}>
            {row.kpiDetail.length > 0 && (
              <ul className={styles.detailList}>
                {row.kpiDetail.map((d) => (
                  <li key={d.label} className={styles.detailItem}>
                    <strong>{d.label}</strong>
                    <span>{d.qty} × {fmtSen(d.bonusCenti)}</span>
                    <span className={styles.detailAmount}>{fmtSen(d.lineCenti)}</span>
                  </li>
                ))}
              </ul>
            )}
            {(row.overrideDetail?.length ?? 0) > 0 && (
              <ul className={styles.detailList}>
                {row.overrideDetail!.map((d) => (
                  <li key={d.level} className={styles.detailItem}>
                    <strong>Level {d.level}</strong>
                    <span>{fmtSen(d.goodsCenti)} × {fmtBps(d.rateBps)}</span>
                    <span className={styles.detailAmount}>{fmtSen(d.commissionCenti)}</span>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
};
