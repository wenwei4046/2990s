import { Fragment, useMemo, useState } from 'react';
import { Download, ChevronRight, ChevronDown } from 'lucide-react';
import { useHrCommission } from '../lib/hr-queries';
import { downloadBlob } from '../lib/audit-export';
import { DateField } from '../components/DateField';
import styles from './Hr.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRM = (centi: number) =>
  `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

// first + last day of the current month as YYYY-MM-DD
const monthRange = () => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(first), to: iso(last) };
};

export const HrCommission = () => {
  const initial = useMemo(monthRange, []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [applied, setApplied] = useState(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const query = useHrCommission(applied.from, applied.to, true);
  const data = query.data;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onExport = async () => {
    if (!data) return;
    const XLSX = await import('xlsx');
    const rows: (string | number)[][] = [[
      'Showroom', 'Salesperson', 'Tier', 'Goods sales (RM)', 'Personal rate', 'Personal commission (RM)',
      'Override rate', 'Override commission (RM)', 'Item KPI (RM)', 'Total (RM)',
    ]];
    for (const s of data.showrooms) {
      for (const r of s.rows) {
        rows.push([
          s.showroomName, r.staffName, r.tier,
          r.personalGoodsCenti / 100, fmtPct(r.personalRateBps), r.personalCommissionCenti / 100,
          r.overrideRateBps ? fmtPct(r.overrideRateBps) : '—', r.overrideCommissionCenti / 100,
          r.itemKpiCenti / 100, r.totalCenti / 100,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commission');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    downloadBlob(new Uint8Array(buf), `2990s-commission-${applied.from}_${applied.to}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>Commission</h1>
        <button className={styles.btn} onClick={onExport} disabled={!data}>
          <Download {...ICON} /> Export Excel
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.field}>
          <span className={styles.label}>From</span>
          <DateField className={styles.input} value={from ?? ''} onChange={(iso) => setFrom(iso)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>To</span>
          <DateField className={styles.input} value={to ?? ''} onChange={(iso) => setTo(iso)} />
        </div>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={!from || !to || from > to}
          onClick={() => {
            if (!from || !to || from > to) return;
            setApplied({ from, to });
          }}
        >
          Calculate
        </button>
      </div>

      {query.isLoading && <div className={styles.empty}>Calculating…</div>}
      {query.isError && <div className={styles.empty}>Failed to load commission.</div>}
      {data && data.showrooms.length === 0 && (
        <div className={styles.empty}>No configured salespeople yet. Add them in HR Settings.</div>
      )}

      {data?.showrooms.map((s) => (
        <div key={s.showroomId} className={styles.card}>
          <div className={styles.showroomHead}>
            <span className={styles.showroomName}>{s.showroomName}</span>
            <span className={s.showroomKpiHit ? styles.hitBadge : styles.missBadge}>
              Showroom goods {fmtRM(s.showroomGoodsCenti)} · 400k {s.showroomKpiHit ? 'hit' : 'not hit'}
            </span>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Salesperson</th><th>Tier</th><th>Goods</th><th>Rate</th><th>Personal</th>
                <th>Override</th><th>Item KPI</th><th>Total</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const open = expanded.has(r.staffId);
                return (
                  <Fragment key={r.staffId}>
                    <tr>
                      <td>
                        {r.kpiDetail.length > 0 && (
                          <button className={styles.iconBtn} onClick={() => toggle(r.staffId)} aria-label="Toggle item KPI detail">
                            {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
                          </button>
                        )}{' '}{r.staffName}
                      </td>
                      <td>{r.tier}</td>
                      <td className={styles.num}>{fmtRM(r.personalGoodsCenti)}</td>
                      <td className={styles.num}>{fmtPct(r.personalRateBps)}</td>
                      <td className={styles.num}>{fmtRM(r.personalCommissionCenti)}</td>
                      <td className={styles.num}>
                        {r.overrideRateBps ? `${fmtPct(r.overrideRateBps)} · ${fmtRM(r.overrideCommissionCenti)}` : '—'}
                      </td>
                      <td className={styles.num}>{fmtRM(r.itemKpiCenti)}</td>
                      <td className={`${styles.num} ${styles.totalCol}`}>{fmtRM(r.totalCenti)}</td>
                    </tr>
                    {open && r.kpiDetail.map((d, i) => (
                      <tr key={`${r.staffId}-d${i}`} className={styles.detailRow}>
                        <td colSpan={6}>↳ {d.label} × {d.qty} @ {fmtRM(d.bonusCenti)}</td>
                        <td className={styles.num} colSpan={2}>{fmtRM(d.lineCenti)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};
