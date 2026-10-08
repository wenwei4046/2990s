// Day-level date range picker (design screen 11): quick picks on the left, two
// month calendars on the right. Click a start date, then an end date; hovering
// previews the range. Days outside the data's span are greyed and inert.

import { useState, type ReactNode } from 'react';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, dfmt, dnum, dparts, MN, presets, rangeLabel, SA_DAY, type SalesDataset } from './sales-model';
import s from './marketing.module.css';

interface Pending { a: number; b: number | null; picking: boolean; hover: number | null; view: [number, number] }

const WD = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export const DateRangePicker = ({ dataset, value, onApply }: {
  dataset: SalesDataset;
  value: { d0: number; d1: number };
  onApply: (r: { d0: number; d1: number }) => void;
}) => {
  const [rp, setRp] = useState<Pending | null>(null);
  const pre = presets(dataset);
  const d0 = Math.min(value.d0, value.d1);
  const d1 = Math.max(value.d0, value.d1);
  const cur = pre.find((p) => p[1] === d0 && p[2] === d1);
  const viewOf = (n: number): [number, number] => { const [y, m] = dparts(n); return addMonths(y, m, -1); };
  const set = (p: Partial<Pending>) => setRp((x) => (x ? { ...x, ...p } : x));

  const pa = rp ? rp.a : d0;
  const pb = rp ? (rp.b ?? rp.hover ?? rp.a) : d1;
  const plo = Math.min(pa, pb);
  const phi = Math.max(pa, pb);
  const [vy, vm] = rp?.view ?? viewOf(d1);
  const [ny, nm] = addMonths(vy, vm, 1);

  const cal = (y: number, m: number) => {
    const first = dnum(y, m, 1);
    const last = dnum(y, m + 1, 0);
    const lead = (new Date(first * SA_DAY).getUTCDay() + 6) % 7;
    const days: ReactNode[] = [];
    for (let i = 0; i < lead; i++) days.push(<span key={`b${i}`} />);
    for (let n = first; n <= last; n++) {
      const has = n >= dataset.d0 && n <= dataset.d1;
      const inR = n >= plo && n <= phi;
      const edge = n === plo || n === phi;
      const radius = plo === phi && edge ? '8px' : n === plo ? '8px 0 0 8px' : n === phi ? '0 8px 8px 0' : inR ? '0' : '8px';
      days.push(
        <button
          key={n}
          type="button"
          className={s.rpDay}
          style={{
            borderRadius: radius,
            background: edge ? 'var(--c-burnt)' : inR ? 'rgba(232,107,58,0.16)' : 'transparent',
            color: edge ? 'var(--c-cream)' : has ? 'var(--c-ink)' : '#C9C1B4',
            fontWeight: edge ? 700 : 500,
            cursor: has ? 'pointer' : 'default',
          }}
          aria-label={dfmt(n)}
          aria-disabled={!has}
          onClick={() => {
            if (!has || !rp) return;
            if (!rp.picking) set({ a: n, b: null, picking: true, hover: n });
            else set({ b: n, picking: false, hover: null });
          }}
          onMouseEnter={() => { if (has && rp?.picking) set({ hover: n }); }}
        >
          {dparts(n)[2]}
        </button>,
      );
    }
    return (
      <div key={`${y}-${m}`} className={s.rpCal}>
        <span className={s.rpCalTitle}>{`${MN[m - 1]} ${y}`}</span>
        <div className={s.rpCalGrid}>
          {WD.map((w) => <span key={w} className={s.rpWd}>{w}</span>)}
          {days}
        </div>
      </div>
    );
  };

  const apply = () => {
    if (!rp || rp.picking || rp.b == null) return;
    onApply({ d0: Math.min(rp.a, rp.b), d1: Math.max(rp.a, rp.b) });
    setRp(null);
  };

  return (
    <div className={s.rpWrap}>
      <button
        type="button"
        className={`${s.rpBtn} ${rp ? s.rpBtnOpen : ''}`}
        aria-haspopup="dialog"
        aria-expanded={!!rp}
        onClick={() => setRp(rp ? null : { a: d0, b: d1, picking: false, hover: null, view: viewOf(d1) })}
      >
        <CalendarRange size={16} strokeWidth={1.75} className={`${s.icon} ${s.rpBtnIcon}`} />
        <span className={s.rpBtnText}>
          <span className={s.rpPreset}>{cur ? cur[0] : 'Custom range'}</span>
          <span className={s.rpLabel}>{rangeLabel(d0, d1)}</span>
        </span>
        <ChevronDown size={14} strokeWidth={1.75} className={`${s.icon} ${s.rpChevron}`} />
      </button>
      {rp && (
        <>
          <div className={s.rpScrim} onClick={() => setRp(null)} />
          <div className={s.rpPop} role="dialog" aria-label="Choose dates">
            <div className={s.rpPresets}>
              <span className={s.rpPresetsTitle}>Quick pick</span>
              {pre.map(([label, a, b]) => {
                const on = !rp.picking && rp.a === a && rp.b === b;
                return (
                  <button
                    key={label}
                    type="button"
                    className={`${s.rpPresetBtn} ${on ? s.rpPresetBtnOn : ''}`}
                    onClick={() => set({ a, b, picking: false, hover: null, view: viewOf(b) })}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className={s.rpMain}>
              <div className={s.rpRow1}>
                <span className={s.rpHint}>{rp.picking ? 'Now pick the end date' : 'Click a start date, then an end date'}</span>
                <span className={s.rpPending}>{plo === phi ? dfmt(plo) : `${dfmt(plo)} – ${dfmt(phi)}`}</span>
              </div>
              <div className={s.rpRow2}>
                <button type="button" className={s.rpNav} aria-label="Previous month" onClick={() => set({ view: addMonths(vy, vm, -1) })}>
                  <ChevronLeft size={14} strokeWidth={1.75} className={s.icon} />
                </button>
                <span className={s.rpDays}>{`${phi - plo + 1} day${phi === plo ? '' : 's'} selected`}</span>
                <button type="button" className={s.rpNav} aria-label="Next month" onClick={() => set({ view: addMonths(vy, vm, 1) })}>
                  <ChevronRight size={14} strokeWidth={1.75} className={s.icon} />
                </button>
              </div>
              <div className={s.rpCals}>
                {cal(vy, vm)}
                {cal(ny, nm)}
              </div>
              <div className={s.rpFoot}>
                <span className={s.rpNote}>Greyed dates have no sales data</span>
                <div className={s.rpActions}>
                  <button type="button" className={s.rpCancel} onClick={() => setRp(null)}>Cancel</button>
                  <button type="button" className={`${s.rpApply} ${rp.picking ? s.rpApplyOff : ''}`} onClick={apply}>Apply</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
