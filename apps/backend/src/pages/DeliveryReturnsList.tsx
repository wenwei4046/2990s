// Delivery Returns list — DataGrid clone of the Delivery Orders list
// (MfgDeliveryOrdersList.tsx), which is itself an SO-clone. Same chrome:
// 4 KPI tiles, draggable filter bar (search · brand · venue · date range),
// status chips, ~visible/hidden column set, right-click context menu,
// click-to-expand line drill-down, and double-click-to-open. Wired to the DR
// list hook + the rebuilt DR API.
//
// A Delivery Return = goods coming BACK from the customer → processing one
// INCREASES stock (handled server-side on create). Returns can ONLY come from
// a Delivery Order, so the toolbar carries a "Convert From DO" picker entry.
//
// UNIQUE localStorage keys ('pr-g.dr-list.layout.v1' /
// 'pr-g.dr-list.filter-order.v1') — never reuse the DO/SO keys.

import { useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, JSX, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, Filter, Search, ArrowDownToLine } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { formatPhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import {
  useDeliveryReturns, useUpdateDeliveryReturnStatus, useDeliveryReturnDetail,
} from '../lib/flow-queries';
import { useStaff } from '../lib/admin-queries';
import { BrandingPill, badgeFor } from '../lib/category-badges';
import styles from './MfgSalesOrdersList.module.css';
import soDetailStyles from './SalesOrderDetail.module.css';

/* ── Row shape (DR header) ─────────────────────────────────────────────── */
type DrRow = {
  id: string;
  return_number: string;
  do_doc_no: string | null;
  delivery_order_id: string | null;
  return_date: string;
  debtor_code: string | null;
  debtor_name: string;
  salesperson_id: string | null;
  sales_location: string | null;
  ref: string | null;
  customer_so_no: string | null;
  branding: string | null;
  venue: string | null;
  phone: string | null;
  email: string | null;
  customer_type: string | null;
  building_type: string | null;
  address1: string | null;
  address2: string | null;
  customer_state: string | null;
  customer_country: string | null;
  city: string | null;
  postcode: string | null;
  reason: string | null;
  local_total_centi: number;
  mattress_sofa_centi?: number;
  bedframe_centi?: number;
  accessories_centi?: number;
  others_centi?: number;
  mattress_sofa_cost_centi?: number;
  bedframe_cost_centi?: number;
  accessories_cost_centi?: number;
  total_cost_centi?: number;
  total_margin_centi?: number;
  margin_pct_basis?: number;
  status: string;
  currency: string;
  note: string | null;
  line_count?: number;
};

const fmtRm = (centi: number): string =>
  (centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONTH_3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const compactDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = m[1], mo = MONTH_3[Number(m[2]) - 1] ?? m[2], d = String(Number(m[3]));
  return `${d} ${mo} ${y}`;
};

/* DR status flow: RECEIVED (= goods back, stock added) → INSPECTED → REFUNDED
   / CREDIT_NOTED, plus REJECTED / CANCELLED. Pill styling reuses the SO detail
   status classes where the stages line up; the rest fall back to a neutral
   pill. */
const STATUS_CLASS: Record<string, string> = {
  PENDING:      soDetailStyles.statusConfirmed ?? '',
  RECEIVED:     soDetailStyles.statusReady ?? '',
  INSPECTED:    soDetailStyles.statusInProd ?? '',
  REFUNDED:     soDetailStyles.statusDelivered ?? '',
  CREDIT_NOTED: soDetailStyles.statusInvoiced ?? '',
  REJECTED:     soDetailStyles.statusCancelled ?? '',
  CANCELLED:    soDetailStyles.statusCancelled ?? '',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING:      'Pending',
  RECEIVED:     'Received',
  INSPECTED:    'Inspected',
  REFUNDED:     'Refunded',
  CREDIT_NOTED: 'Credit Noted',
  REJECTED:     'Rejected',
  CANCELLED:    'Cancelled',
};
/* A return is RECEIVED on creation (stock added then), so the everyday chips
   are Received / Refunded / Cancelled. The rest of the enum still renders in
   the Status column when present. */
const STATUS_CHIPS = ['all', 'RECEIVED', 'REFUNDED', 'CANCELLED'] as const;

const StatusPill = ({ status }: { status: string }) => (
  <span className={`${soDetailStyles.statusPill} ${STATUS_CLASS[status] ?? ''}`}>
    {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
  </span>
);

/* Branding follows the DR's header — mirrors the DO list rule. */
const deriveBranding = (r: DrRow): string => r.branding ?? '';

/* ── Drilldown — per-line breakdown for one DR, mirrors ExpandedDoLines ─── */
type DrItem = {
  id: string;
  item_code: string | null;
  item_group: string | null;
  description: string | null;
  variants: Record<string, unknown> | null;
  uom: string | null;
  qty_returned: number | null;
  condition: string | null;
  unit_price_centi: number | null;
  unit_cost_centi: number | null;
  line_cost_centi: number | null;
  line_margin_centi: number | null;
  line_total_centi: number | null;
};

const CategoryPill = ({ group }: { group: string | null | undefined }) => {
  const spec = badgeFor(group);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999,
      background: spec.bg, color: spec.fg, fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)',
      fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.4, whiteSpace: 'nowrap',
    }}>
      {spec.label}
    </span>
  );
};

/* Per-line cost/margin derivations — shared by the drill-down column
   accessors AND their sort comparators so a sorted cell always agrees with
   the value it sorted by (older rows lack the stored snapshots). */
const drLineTotalOf = (it: DrItem): number => Number(it.line_total_centi ?? 0);
const drLineCostOf = (it: DrItem): number =>
  it.line_cost_centi != null
    ? Number(it.line_cost_centi)
    : Number(it.qty_returned ?? 0) * Number(it.unit_cost_centi ?? 0);
const drLineMarginOf = (it: DrItem): number =>
  it.line_margin_centi != null
    ? Number(it.line_margin_centi)
    : drLineTotalOf(it) - drLineCostOf(it);

/* Drill-down columns — display-only DataGridColumn specs so the DR drill-down
   gets the SAME add/remove · drag-reorder · resize · right-click as the main
   list grids (it used to be a hand-built fixed <table>). Shared layout key
   so the operator's column prefs persist across every DR they expand. */
const buildDrDrilldownColumns = (): DataGridColumn<DrItem>[] => [
  {
    key: 'group', label: 'Group', width: 90, groupable: true,
    accessor: (it) => <CategoryPill group={it.item_group} />,
    searchValue: (it) => it.item_group ?? '',
    groupValue: (it) => it.item_group ?? '(none)',
    sortFn: (a, b) => (a.item_group ?? '').localeCompare(b.item_group ?? ''),
  },
  {
    key: 'item_code', label: 'Item Code', width: 130,
    accessor: (it) => <span style={{ fontWeight: 700, color: 'var(--c-burnt)' }}>{it.item_code ?? '—'}</span>,
    searchValue: (it) => it.item_code ?? '',
    sortFn: (a, b) => (a.item_code ?? '').localeCompare(b.item_code ?? ''),
  },
  {
    key: 'description', label: 'Description', width: 240, minWidth: 180,
    accessor: (it) => {
      const manual = (it.description ?? '').trim();
      const summary = buildVariantSummary(it.item_group, it.variants);
      if (manual) {
        return (
          <>
            <div>{manual}</div>
            {summary && <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-10)', lineHeight: 1.35 }}>{summary}</div>}
          </>
        );
      }
      return summary ? <div>{summary}</div> : '—';
    },
    searchValue: (it) => `${it.description ?? ''} ${buildVariantSummary(it.item_group, it.variants)}`.trim(),
  },
  {
    key: 'condition', label: 'Condition', width: 90, groupable: true,
    accessor: (it) => it.condition || '—',
    searchValue: (it) => it.condition ?? '',
    groupValue: (it) => it.condition ?? '(none)',
    sortFn: (a, b) => (a.condition ?? '').localeCompare(b.condition ?? ''),
  },
  {
    key: 'qty', label: 'Qty', width: 60, align: 'right',
    accessor: (it) => it.qty_returned ?? 0,
    searchValue: (it) => String(it.qty_returned ?? 0),
    sortFn: (a, b) => Number(a.qty_returned ?? 0) - Number(b.qty_returned ?? 0),
  },
  {
    key: 'unit_price', label: 'Unit Price', width: 100, align: 'right',
    accessor: (it) => fmtRm(Number(it.unit_price_centi ?? 0)),
    searchValue: (it) => String(it.unit_price_centi ?? 0),
    sortFn: (a, b) => Number(a.unit_price_centi ?? 0) - Number(b.unit_price_centi ?? 0),
  },
  {
    key: 'total', label: 'Total', width: 100, align: 'right',
    accessor: (it) => <span style={{ fontWeight: 700, color: 'var(--c-burnt)' }}>{fmtRm(drLineTotalOf(it))}</span>,
    searchValue: (it) => String(drLineTotalOf(it)),
    sortFn: (a, b) => drLineTotalOf(a) - drLineTotalOf(b),
  },
  {
    key: 'unit_cost', label: 'Unit Cost', width: 100, align: 'right',
    accessor: (it) => fmtRm(Number(it.unit_cost_centi ?? 0)),
    searchValue: (it) => String(it.unit_cost_centi ?? 0),
    sortFn: (a, b) => Number(a.unit_cost_centi ?? 0) - Number(b.unit_cost_centi ?? 0),
  },
  {
    key: 'line_cost', label: 'Line Cost', width: 100, align: 'right',
    accessor: (it) => fmtRm(drLineCostOf(it)),
    searchValue: (it) => String(drLineCostOf(it)),
    sortFn: (a, b) => drLineCostOf(a) - drLineCostOf(b),
  },
  {
    key: 'margin', label: 'Margin', width: 100, align: 'right',
    accessor: (it) => {
      const m = drLineMarginOf(it);
      const c = m > 0 ? 'var(--c-secondary-a, #2F5D4F)' : m < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
      return <span style={{ color: c, fontWeight: 600 }}>{fmtRm(m)}</span>;
    },
    searchValue: (it) => String(drLineMarginOf(it)),
    sortFn: (a, b) => drLineMarginOf(a) - drLineMarginOf(b),
  },
];

const ExpandedDrLines = ({ id }: { id: string }) => {
  const q = useDeliveryReturnDetail(id);
  if (q.isLoading) {
    return <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>Loading lines…</div>;
  }
  if (q.error) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--c-festive-b, #B8331F)' }}>
        Failed to load lines: {q.error instanceof Error ? q.error.message : String(q.error)}
      </div>
    );
  }
  const items = (q.data?.items ?? []) as DrItem[];
  if (items.length === 0) {
    return <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>No line items.</div>;
  }
  let totalCenti = 0, costCenti = 0;
  for (const it of items) {
    totalCenti += drLineTotalOf(it);
    costCenti  += Number(it.line_cost_centi ?? 0);
  }
  const marginCenti = totalCenti - costCenti;
  const marginColor = marginCenti > 0 ? 'var(--c-secondary-a, #2F5D4F)'
    : marginCenti < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';

  const columns = buildDrDrilldownColumns();

  return (
    <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-2) 40px', background: 'var(--c-cream)' }}>
      <DataGrid<DrItem>
        rows={items}
        columns={columns}
        storageKey="dr-drilldown-grid.v1"
        rowKey={(it) => it.id}
        embedded
        groupBanner={false}
      />
      <div style={{
        display: 'flex', gap: 'var(--space-4)', justifyContent: 'flex-end',
        alignItems: 'baseline', padding: '8px 8px 2px',
        fontSize: 'var(--fs-11)', fontVariantNumeric: 'tabular-nums', color: 'var(--fg-muted)',
      }}>
        <span style={{
          fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>Subtotal</span>
        <span>Total <strong style={{ color: 'var(--c-burnt)' }}>{fmtRm(totalCenti)}</strong></span>
        <span>Line Cost <strong style={{ color: 'var(--c-ink)' }}>{fmtRm(costCenti)}</strong></span>
        <span>Margin <strong style={{ color: marginColor }}>{fmtRm(marginCenti)}</strong></span>
      </div>
    </div>
  );
};

/* ── Filter chrome (matches DO list) ───────────────────────────────────── */
const HOUZS_CARET = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='none'><path d='M1 1l4 4 4-4' stroke='%23878D8D' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>")`;
const HOUZS_SELECT: CSSProperties = {
  height: 32, padding: '0 28px 0 10px',
  background: `#FFFFFF ${HOUZS_CARET} no-repeat right 10px center / 10px 6px`,
  border: '1px solid #DDE5E5', borderRadius: 6, fontFamily: 'var(--font-sans)', fontSize: 11,
  fontWeight: 600, color: '#4B5563', outline: 'none', appearance: 'none', WebkitAppearance: 'none',
  MozAppearance: 'none', cursor: 'pointer', lineHeight: '30px', minWidth: 130,
};
const HOUZS_INPUT_DATE: CSSProperties = {
  height: 32, padding: '0 10px', background: '#FFFFFF', border: '1px solid #DDE5E5', borderRadius: 6,
  fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: '#4B5563', outline: 'none',
  cursor: 'pointer', lineHeight: '30px',
};

type FilterId = 'search' | 'brand' | 'venue' | 'dateRange';
const DEFAULT_FILTER_ORDER: FilterId[] = ['search', 'brand', 'venue', 'dateRange'];
const FILTER_ORDER_KEY = 'pr-g.dr-list.filter-order.v1';

const readFilterOrder = (): FilterId[] => {
  if (typeof window === 'undefined') return DEFAULT_FILTER_ORDER;
  try {
    const raw = window.localStorage.getItem(FILTER_ORDER_KEY);
    if (!raw) return DEFAULT_FILTER_ORDER;
    const parsed = JSON.parse(raw) as FilterId[];
    const known = new Set<FilterId>(DEFAULT_FILTER_ORDER);
    const valid = parsed.filter((f): f is FilterId => known.has(f));
    for (const f of DEFAULT_FILTER_ORDER) if (!valid.includes(f)) valid.push(f);
    return valid;
  } catch { return DEFAULT_FILTER_ORDER; }
};

const DraggableFilter = ({
  id, order, setOrder, children,
}: { id: FilterId; order: FilterId[]; setOrder: (next: FilterId[]) => void; children: ReactNode }) => {
  const [over, setOver] = useState(false);
  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/x-dr-filter', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setOver(true); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    const src = e.dataTransfer.getData('text/x-dr-filter') as FilterId;
    if (!src || src === id) return;
    const next = order.filter((f) => f !== src);
    const idx = next.indexOf(id);
    next.splice(idx, 0, src);
    setOrder(next);
  };
  return (
    <div draggable onDragStart={onDragStart} onDragOver={onDragOver} onDragLeave={() => setOver(false)} onDrop={onDrop}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 2px',
        background: over ? 'rgba(232, 107, 58, 0.10)' : 'transparent', borderRadius: 6, cursor: 'grab',
      }}
      title="Drag to reorder">
      <span aria-hidden style={{ color: '#B0B7B7', fontSize: 11, fontWeight: 700, userSelect: 'none', lineHeight: 1, cursor: 'grab', letterSpacing: -2 }}>::</span>
      {children}
    </div>
  );
};

const STORAGE_KEY = 'pr-g.dr-list.layout.v1';

export const DeliveryReturnsList = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusChip = searchParams.get('status') ?? 'all';

  const { data, isLoading, error } = useDeliveryReturns(undefined);
  const allRows = useMemo<DrRow[]>(() => (data?.deliveryReturns ?? []) as DrRow[], [data]);

  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const [venue, setVenue] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [filterOrder, setFilterOrderRaw] = useState<FilterId[]>(() => readFilterOrder());
  const setFilterOrder = (next: FilterId[]) => {
    setFilterOrderRaw(next);
    try { window.localStorage.setItem(FILTER_ORDER_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };

  const setStatusChip = (s: string) => {
    const next = new URLSearchParams(searchParams);
    if (s === 'all') next.delete('status'); else next.set('status', s);
    setSearchParams(next, { replace: true });
  };

  const filterOptions = useMemo(() => {
    const brands = new Set<string>();
    const venues = new Set<string>();
    for (const r of allRows) {
      const b = deriveBranding(r);
      if (b) brands.add(b);
      if (r.venue) venues.add(r.venue);
    }
    return { brands: [...brands].sort(), venues: [...venues].sort() };
  }, [allRows]);

  const rows = useMemo<DrRow[]>(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (statusChip !== 'all' && r.status !== statusChip) return false;
      if (brand && deriveBranding(r) !== brand) return false;
      if (venue && r.venue !== venue) return false;
      if (dateFrom && (r.return_date ?? '') < dateFrom) return false;
      if (dateTo && (r.return_date ?? '') > dateTo) return false;
      if (q) {
        const blob = [
          r.return_number, r.do_doc_no, r.debtor_name, r.debtor_code, r.venue,
          deriveBranding(r), r.customer_so_no, r.ref, r.phone, r.reason,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, statusChip, search, brand, venue, dateFrom, dateTo]);

  const kpis = useMemo(() => {
    let revenue = 0, cost = 0, margin = 0;
    for (const r of rows) {
      revenue += r.local_total_centi ?? 0;
      cost += r.total_cost_centi ?? 0;
      margin += r.total_margin_centi ?? 0;
    }
    return { totalReturns: rows.length, revenue, cost, margin };
  }, [rows]);

  const resetFilters = () => {
    setSearch(''); setBrand(''); setVenue(''); setDateFrom(''); setDateTo('');
  };

  const staffQ = useStaff();
  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (staffQ.data ?? [])) if (s.id) m.set(s.id, s.name ?? s.staffCode ?? s.id);
    return m;
  }, [staffQ.data]);
  const COLUMNS = useMemo(() => buildColumns(staffById), [staffById]);

  const updateStatus = useUpdateDeliveryReturnStatus();

  const onNew = () => navigate('/delivery-returns/new');
  const onConvertFromDo = () => navigate('/delivery-returns/from-do');
  const openDetail = (row: DrRow, edit = false) =>
    navigate(`/delivery-returns/${row.id}${edit ? '?edit=1' : ''}`);

  const doCancel = (row: DrRow) => {
    if (!window.confirm(`Cancel return ${row.return_number}? This sets status = CANCELLED.`)) return;
    updateStatus.mutate({ id: row.id, status: 'CANCELLED' },
      { onError: (e) => alert(`Failed: ${e instanceof Error ? e.message : String(e)}`) });
  };

  const kpiTile = (label: string, value: string, accent?: 'good' | 'bad' | 'burnt'): JSX.Element => (
    <div key={label} style={{
      background: 'var(--c-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)',
      padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-14)', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
        color: accent === 'good' ? 'var(--c-secondary-a, #2F5D4F)' : accent === 'bad' ? 'var(--c-festive-b, #B8331F)' : accent === 'burnt' ? 'var(--c-burnt)' : 'var(--c-ink)',
      }}>{value}</div>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Delivery Returns</h1>
        </div>
        <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="sm" onClick={onConvertFromDo}>
            <ArrowDownToLine size={14} strokeWidth={1.75} />
            <span>From Delivery Order</span>
          </Button>
          <Button variant="primary" size="sm" onClick={onNew}>
            <Plus size={14} strokeWidth={1.75} />
            <span>New Delivery Return</span>
          </Button>
        </div>
      </div>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-2)' }}>
        {kpiTile('Total Returns', kpis.totalReturns.toLocaleString('en-MY'))}
        {kpiTile('Returned Value (RM)', fmtRm(kpis.revenue))}
        {kpiTile('Cost (RM)', fmtRm(kpis.cost))}
        {kpiTile('Margin (RM)', fmtRm(kpis.margin), kpis.margin > 0 ? 'good' : kpis.margin < 0 ? 'bad' : undefined)}
      </div>

      {/* Status chips. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {STATUS_CHIPS.map((s) => (
          <button key={s} type="button" onClick={() => setStatusChip(s)}
            style={{
              height: 28, padding: '0 12px', borderRadius: 999, cursor: 'pointer',
              fontSize: 11, fontWeight: 600,
              border: '1px solid ' + (statusChip === s ? 'var(--c-burnt)' : '#DDE5E5'),
              background: statusChip === s ? 'rgba(232, 107, 58, 0.10)' : '#FFFFFF',
              color: statusChip === s ? 'var(--c-burnt)' : 'var(--fg-muted)',
            }}>
            {s === 'all' ? 'All' : STATUS_LABEL[s] ?? s}
          </button>
        ))}
      </div>

      {/* Draggable filter row (matches DO list). */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)', background: 'var(--c-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)',
      }}>
        <Filter size={16} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} aria-label="Filters" />
        {filterOrder.map((fid) => {
          switch (fid) {
            case 'search':
              return (
                <DraggableFilter key={fid} id={fid} order={filterOrder} setOrder={setFilterOrder}>
                  <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200, display: 'inline-block' }}>
                    <Search size={14} strokeWidth={1.75}
                      style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }} />
                    <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                      placeholder="Return No, DO, debtor, reason…"
                      style={{ ...HOUZS_INPUT_DATE, paddingLeft: 30, paddingRight: 12, width: 240, cursor: 'text' }} />
                  </div>
                </DraggableFilter>
              );
            case 'brand':
              return (
                <DraggableFilter key={fid} id={fid} order={filterOrder} setOrder={setFilterOrder}>
                  <select value={brand} onChange={(e) => setBrand(e.target.value)} style={HOUZS_SELECT}>
                    <option value="">All Brands</option>
                    {filterOptions.brands.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </DraggableFilter>
              );
            case 'venue':
              return (
                <DraggableFilter key={fid} id={fid} order={filterOrder} setOrder={setFilterOrder}>
                  <select value={venue} onChange={(e) => setVenue(e.target.value)} style={HOUZS_SELECT}>
                    <option value="">All Venues</option>
                    {filterOptions.venues.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </DraggableFilter>
              );
            case 'dateRange':
              return (
                <DraggableFilter key={fid} id={fid} order={filterOrder} setOrder={setFilterOrder}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={HOUZS_INPUT_DATE} />
                    <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>→</span>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={HOUZS_INPUT_DATE} />
                  </span>
                </DraggableFilter>
              );
            default:
              return null;
          }
        })}
        {(search || brand || venue || dateFrom || dateTo) && (
          <button type="button" onClick={resetFilters}
            style={{ background: 'transparent', border: '1px solid #DDE5E5', borderRadius: 6, padding: '0 12px', height: 32, fontSize: 11, fontWeight: 600, color: 'var(--fg-muted)', cursor: 'pointer' }}>
            Reset
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {isLoading ? 'Loading…' : `${rows.length} of ${allRows.length} rows`}
        </span>
      </div>

      <DataGrid<DrRow>
        rows={rows}
        columns={COLUMNS}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.id}
        searchPlaceholder="Search returns…"
        groupBanner={false}
        onRowDoubleClick={(r) => openDetail(r)}
        rowStyle={(r) => ['CANCELLED', 'REJECTED'].includes(r.status) ? { opacity: 0.55, filter: 'grayscale(0.6)' } : undefined}
        isLoading={isLoading}
        emptyMessage='No delivery returns yet — click "From Delivery Order" to start.'
        expandable={{
          renderExpansion: (row) => <ExpandedDrLines id={row.id} />,
          rowExpansionKey: (row) => row.id,
        }}
        contextMenu={(row) => {
          const status = row.status;
          const items: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'Edit', onClick: () => openDetail(row, true) },
            { label: 'View', onClick: () => openDetail(row) },
            { divider: true as const },
          ];
          if (!['CANCELLED', 'REFUNDED', 'CREDIT_NOTED'].includes(status)) {
            items.push({ label: 'Cancel Return', danger: true, onClick: () => doCancel(row) });
          }
          if (status === 'CANCELLED') {
            items.push({
              label: 'Reopen Return',
              onClick: () => {
                if (!window.confirm(`Reopen ${row.return_number} back to RECEIVED?`)) return;
                updateStatus.mutate({ id: row.id, status: 'RECEIVED' });
              },
            });
          }
          return items;
        }}
      />
    </div>
  );
};

/* ── Columns — mirrors the DO list set, adapted to DR fields. ───────────── */
const buildColumns = (staffById: Map<string, string>): DataGridColumn<DrRow>[] => [
  {
    key: 'return_number', label: 'Return No.', width: 150, sortable: true,
    accessor: (r) => (
      <span style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>{r.return_number}</span>
    ),
    searchValue: (r) => `${r.return_number} ${r.status ?? ''}`,
  },
  {
    key: 'do_doc_no', label: 'DO Ref', width: 130, sortable: true,
    accessor: (r) => r.do_doc_no ?? '—',
    searchValue: (r) => r.do_doc_no ?? '',
  },
  {
    key: 'return_date', label: 'Date', width: 110, sortable: true,
    accessor: (r) => compactDate(r.return_date),
    searchValue: (r) => `${r.return_date ?? ''} ${compactDate(r.return_date)}`,
    sortFn: (a, b) => (a.return_date ?? '').localeCompare(b.return_date ?? ''),
  },
  {
    key: 'debtor_name', label: 'Debtor Name', width: 220, sortable: true, groupable: true,
    accessor: (r) => r.debtor_name,
    searchValue: (r) => r.debtor_name,
  },
  {
    key: 'salesperson_id', label: 'Salesperson', width: 140, sortable: true, groupable: true,
    accessor: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '—' : '—'),
    searchValue: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '' : ''),
    groupValue: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '(none)' : '(none)'),
  },
  {
    key: 'sales_location', label: 'Location', width: 100, sortable: true, groupable: true,
    accessor: (r) => r.sales_location ?? '—',
    searchValue: (r) => r.sales_location ?? '',
    groupValue: (r) => r.sales_location ?? '(none)',
  },
  {
    key: 'reason', label: 'Reason', width: 160, sortable: true,
    accessor: (r) => r.reason ?? '—',
    searchValue: (r) => r.reason ?? '',
  },
  {
    key: 'customer_so_no', label: 'Reference', width: 130, sortable: true,
    accessor: (r) => r.customer_so_no ?? r.ref ?? '—',
    searchValue: (r) => `${r.customer_so_no ?? ''} ${r.ref ?? ''}`,
    sortFn: (a, b) => (a.customer_so_no ?? a.ref ?? '').localeCompare(b.customer_so_no ?? b.ref ?? ''),
  },
  {
    key: 'branding', label: 'Branding', width: 130, sortable: true, groupable: true,
    accessor: (r) => {
      const b = deriveBranding(r);
      return b ? <BrandingPill branding={b} /> : <span style={{ color: 'var(--fg-muted)' }}>—</span>;
    },
    searchValue: (r) => deriveBranding(r),
    groupValue: (r) => deriveBranding(r) || '(none)',
    sortFn: (a, b) => deriveBranding(a).localeCompare(deriveBranding(b)),
  },
  {
    key: 'venue', label: 'Venue', width: 180, sortable: true, groupable: true,
    accessor: (r) => r.venue ?? '—',
    searchValue: (r) => r.venue ?? '',
    groupValue: (r) => r.venue ?? '(none)',
  },
  {
    key: 'local_total_centi', label: 'Returned Value', width: 130, sortable: true, align: 'right',
    accessor: (r) => (
      <span style={{ fontWeight: 700, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(r.local_total_centi)}</span>
    ),
    searchValue: (r) => fmtRm(r.local_total_centi),
    sortFn: (a, b) => a.local_total_centi - b.local_total_centi,
  },
  {
    key: 'mattress_sofa_centi', label: 'Mattress/Sofa', width: 130, sortable: true, align: 'right',
    accessor: (r) => {
      const v = r.mattress_sofa_centi ?? 0;
      if (v === 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      return <span style={{ fontWeight: 600, color: badgeFor('sofa').fg, fontVariantNumeric: 'tabular-nums' }}>{fmtRm(v)}</span>;
    },
    searchValue: (r) => fmtRm(r.mattress_sofa_centi ?? 0),
    sortFn: (a, b) => (a.mattress_sofa_centi ?? 0) - (b.mattress_sofa_centi ?? 0),
  },
  {
    key: 'bedframe_centi', label: 'Bedframe', width: 120, sortable: true, align: 'right',
    accessor: (r) => {
      const v = r.bedframe_centi ?? 0;
      if (v === 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      return <span style={{ fontWeight: 600, color: badgeFor('bedframe').fg, fontVariantNumeric: 'tabular-nums' }}>{fmtRm(v)}</span>;
    },
    searchValue: (r) => fmtRm(r.bedframe_centi ?? 0),
    sortFn: (a, b) => (a.bedframe_centi ?? 0) - (b.bedframe_centi ?? 0),
  },
  {
    key: 'accessories_centi', label: 'Accessories', width: 120, sortable: true, align: 'right',
    accessor: (r) => {
      const v = r.accessories_centi ?? 0;
      if (v === 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      return <span style={{ fontWeight: 600, color: badgeFor('accessory').fg, fontVariantNumeric: 'tabular-nums' }}>{fmtRm(v)}</span>;
    },
    searchValue: (r) => fmtRm(r.accessories_centi ?? 0),
    sortFn: (a, b) => (a.accessories_centi ?? 0) - (b.accessories_centi ?? 0),
  },
  {
    key: 'phone', label: 'Phone', width: 130, sortable: true,
    accessor: (r) => formatPhone(r.phone) || '',
    searchValue: (r) => `${r.phone ?? ''} ${formatPhone(r.phone) ?? ''}`,
  },
  {
    key: 'address1', label: 'Address 1', width: 180, sortable: true,
    accessor: (r) => r.address1 ?? '',
    searchValue: (r) => r.address1 ?? '',
  },
  {
    key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
    accessor: (r) => <StatusPill status={r.status} />,
    searchValue: (r) => r.status,
    groupValue: (r) => r.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
  /* ── Default-hidden long-tail ── */
  {
    key: 'debtor_code', label: 'Customer Code', width: 120, sortable: true, defaultHidden: true,
    accessor: (r) => r.debtor_code ?? '',
    searchValue: (r) => r.debtor_code ?? '',
  },
  {
    key: 'email', label: 'Email', width: 180, sortable: true, defaultHidden: true,
    accessor: (r) => r.email ?? '',
    searchValue: (r) => r.email ?? '',
  },
  {
    key: 'customer_type', label: 'Customer Type', width: 120, sortable: true, groupable: true, defaultHidden: true,
    accessor: (r) => r.customer_type ?? '',
    searchValue: (r) => r.customer_type ?? '',
  },
  {
    key: 'building_type', label: 'Building Type', width: 120, sortable: true, groupable: true, defaultHidden: true,
    accessor: (r) => r.building_type ?? '',
    searchValue: (r) => r.building_type ?? '',
  },
  {
    key: 'address2', label: 'Address 2', width: 180, sortable: true, defaultHidden: true,
    accessor: (r) => r.address2 ?? '',
    searchValue: (r) => r.address2 ?? '',
  },
  {
    key: 'customer_state', label: 'State', width: 130, sortable: true, groupable: true, defaultHidden: true,
    accessor: (r) => r.customer_state ?? '',
    searchValue: (r) => r.customer_state ?? '',
  },
  {
    key: 'city', label: 'City', width: 130, sortable: true, groupable: true, defaultHidden: true,
    accessor: (r) => r.city ?? '',
    searchValue: (r) => r.city ?? '',
  },
  {
    key: 'postcode', label: 'Postcode', width: 100, sortable: true, defaultHidden: true,
    accessor: (r) => r.postcode ?? '',
    searchValue: (r) => r.postcode ?? '',
  },
  {
    key: 'note', label: 'Note', width: 200, sortable: true, defaultHidden: true,
    accessor: (r) => r.note ?? '',
    searchValue: (r) => r.note ?? '',
  },
  {
    key: 'total_cost_centi', label: 'Cost Total', width: 120, sortable: true, align: 'right', defaultHidden: true,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.total_cost_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.total_cost_centi ?? 0),
    sortFn: (a, b) => (a.total_cost_centi ?? 0) - (b.total_cost_centi ?? 0),
  },
  {
    key: 'total_margin_centi', label: 'Margin', width: 120, sortable: true, align: 'right', defaultHidden: true,
    accessor: (r) => {
      const m = r.total_margin_centi ?? 0;
      if ((r.local_total_centi ?? 0) <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      const color = m > 0 ? 'var(--c-secondary-a, #2F5D4F)' : m < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
      return <span className={styles.money} style={{ color, fontWeight: 600 }}>{fmtRm(m)}</span>;
    },
    searchValue: (r) => fmtRm(r.total_margin_centi ?? 0),
    sortFn: (a, b) => (a.total_margin_centi ?? 0) - (b.total_margin_centi ?? 0),
  },
];
