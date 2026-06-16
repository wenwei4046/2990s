/* Column-aware filter bar (shared across the SO/DO/SI/consignment list pages).
 *
 * Replaces the old fixed "search · All Brands ▼ · All Venues ▼ · date range"
 * row that was copy-pasted across ~8 listing pages. Instead the user:
 *   1. keeps a free-text quick-search box, and
 *   2. clicks "+ Add filter", picks a COLUMN, and gets a value control that
 *      adapts to that column's TYPE:
 *        - enum  → dropdown of the distinct values actually present in the data
 *        - date  → presets (Today / Tomorrow / This week / This month /
 *                  Last month) + a custom from–to range
 *        - text  → contains-text
 * Multiple active filters AND together. Each is a removable chip. The active
 * set persists per page (localStorage by `storageKey`).
 *
 * Config-driven: a page passes its `columns` (key/label/type/accessor) and its
 * rows; the hook returns the filtered rows + the bar JSX. No page keeps its own
 * brand/venue/date state any more.
 *
 * Styling matches the existing HOUZS filter chrome (design tokens + the same
 * 32px white controls with #DDE5E5 borders); no new deps. */
import { useMemo, useState, useRef, useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Filter, Search, Plus, X } from 'lucide-react';

export type FilterColType = 'text' | 'enum' | 'date';

export interface FilterColumn<T> {
  /** Stable key (used in persisted state + as the React key). */
  key: string;
  /** Human label shown in the "Add filter" menu + the active chip. */
  label: string;
  type: FilterColType;
  /** Returns the comparable value for a row. For `date`, return an
   *  ISO `YYYY-MM-DD` (or null). For `enum`/`text`, the display string. */
  accessor: (row: T) => string | null | undefined;
}

type DatePreset = 'today' | 'tomorrow' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'overdue' | 'custom';

interface ActiveFilter {
  key: string;
  enumValue?: string;
  text?: string;
  preset?: DatePreset;
  from?: string;
  to?: string;
}

const blank = (v: string | null | undefined): boolean => v == null || String(v).trim() === '';
const iso = (d: Date): string => {
  // Local-date ISO (YYYY-MM-DD) — matches how the rows store dates.
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/** Resolve a date preset to an inclusive [from,to] ISO range. */
function presetRange(preset: DatePreset, from?: string, to?: string): { from: string; to: string } {
  if (preset === 'custom') return { from: from ?? '', to: to ?? '' };
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = 86400000;
  switch (preset) {
    case 'today': return { from: iso(now), to: iso(now) };
    case 'tomorrow': { const t = new Date(now.getTime() + day); return { from: iso(t), to: iso(t) }; }
    case 'thisWeek': {
      // Monday-start week.
      const dow = (now.getDay() + 6) % 7;
      const mon = new Date(now.getTime() - dow * day);
      const sun = new Date(mon.getTime() + 6 * day);
      return { from: iso(mon), to: iso(sun) };
    }
    case 'thisMonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: iso(s), to: iso(e) };
    }
    case 'lastMonth': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(s), to: iso(e) };
    }
    case 'overdue': {
      // Everything strictly before today (mirrors DataGrid's 'overdue').
      const y = new Date(now.getTime() - day);
      return { from: '', to: iso(y) };
    }
    default: return { from: '', to: '' };
  }
}

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  overdue: 'Overdue',
  custom: 'Custom range…',
};

// ── Shared control styling (matches the old HOUZS_SELECT / _INPUT_DATE) ──
const SELECT_STYLE: CSSProperties = {
  height: 32, padding: '0 26px 0 10px',
  background: `#FFFFFF url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' stroke='%234B5563' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat right 10px center`,
  border: '1px solid #DDE5E5', borderRadius: 6,
  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: '#4B5563',
  outline: 'none', appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
  cursor: 'pointer', lineHeight: '30px',
};
const INPUT_STYLE: CSSProperties = {
  height: 32, padding: '0 10px', background: '#FFFFFF',
  border: '1px solid #DDE5E5', borderRadius: 6,
  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: '#4B5563',
  outline: 'none', lineHeight: '30px',
};
const CHIP_STYLE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '0 4px 0 8px', height: 32,
  background: 'var(--c-paper, #fff)', border: '1px solid #DDE5E5',
  borderRadius: 6,
};
const CHIP_LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--font-sans)', fontSize: 10, fontWeight: 700,
  textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--fg-muted, #6B7280)',
};

export interface UseColumnFilterArgs<T> {
  allRows: T[];
  columns: FilterColumn<T>[];
  /** Quick free-text search across these column keys (defaults to all
   *  text/enum columns). */
  quickSearchKeys?: string[];
  quickSearchPlaceholder?: string;
  /** localStorage key for persisting the active filter set. */
  storageKey: string;
  /** Optional node rendered on the far right of the bar. Overrides the
   *  built-in "{shown} of {total} rows" count. */
  rightSlot?: ReactNode;
  /** Denominator for the built-in count (defaults to allRows.length). */
  totalCount?: number;
  /** When true the built-in count shows "Loading…". */
  loading?: boolean;
}

export interface UseColumnFilterResult<T> {
  rows: T[];
  /** True when any quick-search or column filter is active. */
  active: boolean;
  reset: () => void;
  bar: ReactNode;
}

export function useColumnFilter<T>({
  allRows, columns, quickSearchKeys, quickSearchPlaceholder, storageKey, rightSlot,
  totalCount, loading,
}: UseColumnFilterArgs<T>): UseColumnFilterResult<T> {
  const colByKey = useMemo(() => {
    const m = new Map<string, FilterColumn<T>>();
    for (const c of columns) m.set(c.key, c);
    return m;
  }, [columns]);

  const [search, setSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ActiveFilter[];
      // Drop any persisted filter whose column no longer exists.
      return Array.isArray(parsed) ? parsed.filter((f) => f && typeof f.key === 'string') : [];
    } catch { return []; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(activeFilters)); } catch { /* ignore */ }
  }, [activeFilters, storageKey]);

  // Distinct enum options per column, derived from the data.
  const optionsByKey = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of columns) {
      if (c.type !== 'enum') continue;
      const set = new Set<string>();
      for (const r of allRows) {
        const v = c.accessor(r);
        if (!blank(v)) set.add(String(v).trim());
      }
      m.set(c.key, [...set].sort((a, b) => a.localeCompare(b)));
    }
    return m;
  }, [columns, allRows]);

  const searchKeys = quickSearchKeys
    ?? columns.filter((c) => c.type !== 'date').map((c) => c.key);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      // Quick search — OR across the configured keys.
      if (q) {
        const blob = searchKeys
          .map((k) => colByKey.get(k)?.accessor(r))
          .filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      // Active column filters — AND.
      for (const f of activeFilters) {
        const col = colByKey.get(f.key);
        if (!col) continue;
        const raw = col.accessor(r);
        if (col.type === 'enum') {
          if (!blank(f.enumValue) && String(raw ?? '').trim() !== f.enumValue) return false;
        } else if (col.type === 'text') {
          if (!blank(f.text) && !String(raw ?? '').toLowerCase().includes(f.text!.toLowerCase())) return false;
        } else if (col.type === 'date') {
          const { from, to } = presetRange(f.preset ?? 'custom', f.from, f.to);
          const d = String(raw ?? '');
          if (from && (blank(d) || d < from)) return false;
          if (to && (blank(d) || d > to)) return false;
        }
      }
      return true;
    });
  }, [allRows, search, activeFilters, colByKey, searchKeys]);

  const active = !!search || activeFilters.length > 0;
  const reset = () => { setSearch(''); setActiveFilters([]); };

  const addFilter = (key: string) => {
    const col = colByKey.get(key);
    if (!col) return;
    const f: ActiveFilter = { key };
    if (col.type === 'date') f.preset = 'thisMonth';
    setActiveFilters((prev) => [...prev, f]);
  };
  const removeFilter = (idx: number) =>
    setActiveFilters((prev) => prev.filter((_, i) => i !== idx));
  const patchFilter = (idx: number, patch: Partial<ActiveFilter>) =>
    setActiveFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const availableToAdd = columns.filter((c) => !activeFilters.some((f) => f.key === c.key));

  const bar = (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)',
      padding: 'var(--space-2) var(--space-3)', background: 'var(--c-paper)',
      border: '1px solid var(--line)', borderRadius: 'var(--radius-md)',
    }}>
      <Filter size={16} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} aria-label="Filters" />

      {/* Quick free-text search */}
      <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
        <Search size={14} strokeWidth={1.75}
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }} />
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={quickSearchPlaceholder ?? 'Search…'}
          style={{ ...INPUT_STYLE, paddingLeft: 30, width: '100%' }}
        />
      </div>

      {/* Active column filters */}
      {activeFilters.map((f, idx) => {
        const col = colByKey.get(f.key);
        if (!col) return null;
        return (
          <span key={`${f.key}-${idx}`} style={CHIP_STYLE}>
            <span style={CHIP_LABEL_STYLE}>{col.label}</span>
            {col.type === 'enum' && (
              <select value={f.enumValue ?? ''} onChange={(e) => patchFilter(idx, { enumValue: e.target.value })}
                style={{ ...SELECT_STYLE, height: 26, border: 'none', minWidth: 110, padding: '0 22px 0 4px' }}>
                <option value="">Any</option>
                {(optionsByKey.get(f.key) ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {col.type === 'text' && (
              <input type="text" value={f.text ?? ''} onChange={(e) => patchFilter(idx, { text: e.target.value })}
                placeholder="contains…"
                style={{ ...INPUT_STYLE, height: 26, border: 'none', width: 120, padding: '0 4px' }} />
            )}
            {col.type === 'date' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <select value={f.preset ?? 'custom'} onChange={(e) => patchFilter(idx, { preset: e.target.value as DatePreset })}
                  style={{ ...SELECT_STYLE, height: 26, border: 'none', minWidth: 104, padding: '0 22px 0 4px' }}>
                  {(['today', 'tomorrow', 'thisWeek', 'thisMonth', 'lastMonth', 'overdue', 'custom'] as DatePreset[])
                    .map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
                </select>
                {f.preset === 'custom' && (
                  <>
                    <input type="date" value={f.from ?? ''} onChange={(e) => patchFilter(idx, { from: e.target.value })}
                      style={{ ...INPUT_STYLE, height: 26, padding: '0 6px' }} />
                    <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>→</span>
                    <input type="date" value={f.to ?? ''} onChange={(e) => patchFilter(idx, { to: e.target.value })}
                      style={{ ...INPUT_STYLE, height: 26, padding: '0 6px' }} />
                  </>
                )}
              </span>
            )}
            <button type="button" onClick={() => removeFilter(idx)} aria-label={`Remove ${col.label} filter`}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, padding: 0, background: 'transparent', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', borderRadius: 4 }}>
              <X size={13} strokeWidth={2} />
            </button>
          </span>
        );
      })}

      {/* + Add filter */}
      {availableToAdd.length > 0 && (
        <AddFilterMenu columns={availableToAdd} onPick={addFilter} />
      )}

      {active && (
        <button type="button" onClick={reset}
          style={{ background: 'transparent', border: '1px solid #DDE5E5', borderRadius: 6, padding: '0 12px', height: 32, fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', cursor: 'pointer' }}>
          Reset
        </button>
      )}

      <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        {rightSlot != null ? rightSlot : (loading ? 'Loading…' : `${rows.length} of ${totalCount ?? allRows.length} rows`)}
      </span>
    </div>
  );

  return { rows, active, reset, bar };
}

/** The "+ Add filter" button + a small column-picker popover. */
function AddFilterMenu<T>({ columns, onPick }: { columns: FilterColumn<T>[]; onPick: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, padding: '0 10px', background: '#FFFFFF', border: '1px dashed #C7D0D0', borderRadius: 6, fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: '#4B5563', cursor: 'pointer' }}>
        <Plus size={13} strokeWidth={2} /> Add filter
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 30,
          minWidth: 180, maxHeight: 320, overflowY: 'auto',
          background: '#FFFFFF', border: '1px solid #DDE5E5', borderRadius: 8,
          boxShadow: 'var(--shadow-3, 0 8px 24px rgba(34,31,32,0.16))', padding: 4,
        }}>
          {columns.map((c) => (
            <button key={c.key} type="button"
              onClick={() => { onPick(c.key); setOpen(false); }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: 6, fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600, color: 'var(--c-ink, #221F20)', cursor: 'pointer' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-cream, #F6F2EC)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
