// Sales Invoices list — DataGrid clone of the Delivery Orders list
// (MfgDeliveryOrdersList.tsx, itself an SO-list clone). Same chrome: 4 KPI
// tiles, draggable filter bar (search · brand · venue · date range), status
// chips, visible/hidden column set, right-click context menu, click-to-expand
// line drill-down, and double-click-to-open. Wired to the SI list hook + the
// rebuilt SI API. Primary entry to create is "Convert From DO" (the picker),
// with a standalone "New" alongside it (matching the PO list's From-SO + New).
//
// UNIQUE localStorage keys ('pr-g.si-list.layout.v1' /
// 'pr-g.si-list.filter-order.v1') — never reuse the DO/SO keys.

import { useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, JSX, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, Filter, Search, ArrowRightLeft } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { formatPhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import {
  useSalesInvoices, useUpdateSalesInvoiceStatus, useSalesInvoiceDetail,
} from '../lib/flow-queries';
import { useStaff } from '../lib/admin-queries';
import { supabase } from '../lib/supabase';
import { BrandingPill, badgeFor } from '../lib/category-badges';
import styles from './MfgSalesOrdersList.module.css';
import soDetailStyles from './SalesOrderDetail.module.css';

/* ── Row shape (SI header) ─────────────────────────────────────────────── */
type SiRow = {
  id: string;
  invoice_number: string;
  so_doc_no: string | null;
  delivery_order_id: string | null;
  invoice_date: string;
  due_date: string | null;
  customer_delivery_date: string | null;
  debtor_code: string | null;
  debtor_name: string;
  salesperson_id: string | null;
  sales_location: string | null;
  ref: string | null;
  customer_so_no: string | null;
  po_doc_no: string | null;
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
  local_total_centi: number;
  total_centi: number;
  paid_centi: number;
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

/* SI status flow (kept simple, like the DO): SENT (issued) → PARTIALLY_PAID →
   PAID, plus CANCELLED. Pill styling reuses the SO detail status classes where
   they line up; the rest fall back to a neutral pill. */
const STATUS_CLASS: Record<string, string> = {
  SENT:           soDetailStyles.statusShipped ?? '',
  PARTIALLY_PAID: soDetailStyles.statusInProd ?? '',
  PAID:           soDetailStyles.statusDelivered ?? '',
  OVERDUE:        soDetailStyles.statusCancelled ?? '',
  CANCELLED:      soDetailStyles.statusCancelled ?? '',
};
const STATUS_LABEL: Record<string, string> = {
  SENT:           'Issued',
  PARTIALLY_PAID: 'Partially Paid',
  PAID:           'Paid',
  OVERDUE:        'Overdue',
  CANCELLED:      'Cancelled',
};
const STATUS_CHIPS = ['all', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;

const StatusPill = ({ status }: { status: string }) => (
  <span className={`${soDetailStyles.statusPill} ${STATUS_CLASS[status] ?? ''}`}>
    {STATUS_LABEL[status] ?? status.replace(/_/g, ' ')}
  </span>
);

/* Branding follows the SI header (carried from the DO). */
const deriveBranding = (r: SiRow): string => r.branding ?? '';

/* ── Drilldown — per-line breakdown for one SI, mirrors ExpandedDoLines ─── */
type SiItem = {
  id: string;
  item_code: string | null;
  item_group: string | null;
  description: string | null;
  variants: Record<string, unknown> | null;
  uom: string | null;
  qty: number | null;
  unit_price_centi: number | null;
  unit_cost_centi: number | null;
  line_cost_centi: number | null;
  line_margin_centi: number | null;
  line_total_centi: number | null;
};

const TH_BASE: CSSProperties = { padding: '2px 8px', textAlign: 'left' };
const TH_RIGHT: CSSProperties = { ...TH_BASE, textAlign: 'right' };
const TD_BASE: CSSProperties = { padding: '3px 8px', verticalAlign: 'top' };
const TD_RIGHT: CSSProperties = { ...TD_BASE, textAlign: 'right' };
const TFOOT_LABEL: CSSProperties = {
  ...TD_RIGHT, paddingTop: 6, paddingBottom: 4,
  fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)', letterSpacing: '0.06em',
  textTransform: 'uppercase', color: 'var(--fg-muted)',
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

const ExpandedSiLines = ({ id }: { id: string }) => {
  const q = useSalesInvoiceDetail(id);
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
  const items = (q.data?.items ?? []) as SiItem[];
  if (items.length === 0) {
    return <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>No line items.</div>;
  }
  let totalCenti = 0, costCenti = 0;
  for (const it of items) {
    totalCenti += Number(it.line_total_centi ?? 0);
    costCenti  += Number(it.line_cost_centi ?? 0);
  }
  const marginCenti = totalCenti - costCenti;
  const marginColor = marginCenti > 0 ? 'var(--c-secondary-a, #2F5D4F)'
    : marginCenti < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';

  return (
    <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-2) 40px', background: 'var(--c-cream)' }}>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{
          width: 1080, minWidth: 1080, borderCollapse: 'collapse',
          fontSize: 'var(--fs-11)', fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)', tableLayout: 'fixed',
        }}>
          <thead>
            <tr style={{
              color: 'var(--fg-muted)', fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)',
              letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid rgba(34, 31, 32, 0.10)',
            }}>
              <th style={{ ...TH_BASE, width: 90 }}>Group</th>
              <th style={{ ...TH_BASE, width: 130 }}>Item Code</th>
              <th style={{ ...TH_BASE, width: 260, minWidth: 200, maxWidth: 340 }}>Description</th>
              <th style={{ ...TH_BASE, width: 60 }}>UOM</th>
              <th style={{ ...TH_RIGHT, width: 50 }}>Qty</th>
              <th style={{ ...TH_RIGHT, width: 90 }}>Unit Price</th>
              <th style={{ ...TH_RIGHT, width: 90 }}>Total</th>
              <th style={{ ...TH_RIGHT, width: 90 }}>Unit Cost</th>
              <th style={{ ...TH_RIGHT, width: 90 }}>Line Cost</th>
              <th style={{ ...TH_RIGHT, width: 90 }}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const lineTotal = Number(it.line_total_centi ?? 0);
              const lineCost = it.line_cost_centi != null
                ? Number(it.line_cost_centi)
                : Number(it.qty ?? 0) * Number(it.unit_cost_centi ?? 0);
              const lineMargin = it.line_margin_centi != null ? Number(it.line_margin_centi) : lineTotal - lineCost;
              const lineMarginColor = lineMargin > 0 ? 'var(--c-secondary-a, #2F5D4F)'
                : lineMargin < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
              return (
                <tr key={it.id} style={{ borderTop: '1px solid rgba(34, 31, 32, 0.05)' }}>
                  <td style={TD_BASE}><CategoryPill group={it.item_group} /></td>
                  <td style={{ ...TD_BASE, fontWeight: 700, color: 'var(--c-burnt)' }}>{it.item_code ?? '—'}</td>
                  <td style={TD_BASE}>
                    {(() => {
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
                    })()}
                  </td>
                  <td style={TD_BASE}>{it.uom || 'UNIT'}</td>
                  <td style={TD_RIGHT}>{it.qty ?? 0}</td>
                  <td style={TD_RIGHT}>{fmtRm(Number(it.unit_price_centi ?? 0))}</td>
                  <td style={{ ...TD_RIGHT, fontWeight: 700, color: 'var(--c-burnt)' }}>{fmtRm(lineTotal)}</td>
                  <td style={TD_RIGHT}>{fmtRm(Number(it.unit_cost_centi ?? 0))}</td>
                  <td style={TD_RIGHT}>{fmtRm(lineCost)}</td>
                  <td style={{ ...TD_RIGHT, color: lineMarginColor, fontWeight: 600 }}>{fmtRm(lineMargin)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid rgba(34, 31, 32, 0.18)' }}>
              <td style={{ ...TFOOT_LABEL }} colSpan={6}>Subtotal</td>
              <td style={{ ...TD_RIGHT, paddingTop: 6, fontWeight: 700, color: 'var(--c-burnt)' }}>{fmtRm(totalCenti)}</td>
              <td style={{ ...TD_RIGHT, paddingTop: 6, color: 'var(--fg-muted)' }}>—</td>
              <td style={{ ...TD_RIGHT, paddingTop: 6 }}>{fmtRm(costCenti)}</td>
              <td style={{ ...TD_RIGHT, paddingTop: 6, fontWeight: 700, color: marginColor }}>{fmtRm(marginCenti)}</td>
            </tr>
          </tfoot>
        </table>
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
const FILTER_ORDER_KEY = 'pr-g.si-list.filter-order.v1';

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
    e.dataTransfer.setData('text/x-si-filter', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setOver(true); };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    const src = e.dataTransfer.getData('text/x-si-filter') as FilterId;
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

const STORAGE_KEY = 'pr-g.si-list.layout.v1';

export const SalesInvoicesList = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusChip = searchParams.get('status') ?? 'all';

  const { data, isLoading, error } = useSalesInvoices(undefined);
  const allRows = useMemo<SiRow[]>(() => (data?.salesInvoices ?? []) as SiRow[], [data]);

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

  const rows = useMemo<SiRow[]>(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (statusChip !== 'all' && r.status !== statusChip) return false;
      if (brand && deriveBranding(r) !== brand) return false;
      if (venue && r.venue !== venue) return false;
      if (dateFrom && (r.invoice_date ?? '') < dateFrom) return false;
      if (dateTo && (r.invoice_date ?? '') > dateTo) return false;
      if (q) {
        const blob = [
          r.invoice_number, r.so_doc_no, r.debtor_name, r.debtor_code, r.venue,
          deriveBranding(r), r.customer_so_no, r.ref, r.po_doc_no, r.phone,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, statusChip, search, brand, venue, dateFrom, dateTo]);

  const localTotal = (r: SiRow) => r.local_total_centi || r.total_centi || 0;

  const kpis = useMemo(() => {
    let revenue = 0, cost = 0, margin = 0, outstanding = 0;
    for (const r of rows) {
      revenue += localTotal(r);
      cost += r.total_cost_centi ?? 0;
      margin += r.total_margin_centi ?? 0;
      if (r.status !== 'CANCELLED') outstanding += Math.max(0, (r.total_centi ?? localTotal(r)) - (r.paid_centi ?? 0));
    }
    return { totalInvoices: rows.length, revenue, cost, margin, outstanding };
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

  const updateStatus = useUpdateSalesInvoiceStatus();

  const onConvertFromDo = () => navigate('/sales-invoices/from-do');
  const onNew = () => navigate('/sales-invoices/new');
  const openDetail = (row: SiRow, edit = false) =>
    navigate(`/sales-invoices/${row.id}${edit ? '?edit=1' : ''}`);

  const renderPdf = (row: SiRow) => {
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token ?? '';
      const res = await fetch(`${import.meta.env.VITE_API_URL}/sales-invoices/${row.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert(`Failed to load invoice ${row.invoice_number}`); return; }
      const json = (await res.json()) as { salesInvoice: unknown; items: unknown[] };
      const { generateSalesInvoicePdf } = await import('../lib/sales-invoice-pdf');
      await generateSalesInvoicePdf(json.salesInvoice as never, json.items as never);
    })().catch((e) => alert(`PDF failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  const doCancel = (row: SiRow) => {
    if (!window.confirm(`Cancel invoice ${row.invoice_number}? This sets status = CANCELLED.`)) return;
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
          <h1 className={styles.title}>Sales Invoices</h1>
          <p className={styles.subtitle}>
            AutoCount-style ledger view
            {' · '}{isLoading ? 'Loading…' : `${rows.length} of ${allRows.length} total`}
            {' · drag :: to reorder columns'}
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="sm" onClick={onConvertFromDo}>
            <ArrowRightLeft size={14} strokeWidth={1.75} />
            <span>From Delivery Order</span>
          </Button>
          <Button variant="primary" size="sm" onClick={onNew}>
            <Plus size={14} strokeWidth={1.75} />
            <span>New Invoice</span>
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
        {kpiTile('Total Invoices', kpis.totalInvoices.toLocaleString('en-MY'))}
        {kpiTile('Revenue (RM)', fmtRm(kpis.revenue))}
        {kpiTile('Outstanding (RM)', fmtRm(kpis.outstanding), kpis.outstanding > 0 ? 'bad' : 'good')}
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
                      placeholder="Invoice No, SO, debtor…"
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

      <DataGrid<SiRow>
        rows={rows}
        columns={COLUMNS}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.id}
        searchPlaceholder="Search invoices…"
        groupBanner={false}
        onRowDoubleClick={(r) => openDetail(r)}
        rowStyle={(r) => r.status === 'CANCELLED' ? { opacity: 0.55, filter: 'grayscale(0.6)' } : undefined}
        isLoading={isLoading}
        emptyMessage='No sales invoices yet — click "From Delivery Order" to convert one.'
        expandable={{
          renderExpansion: (row) => <ExpandedSiLines id={row.id} />,
          rowExpansionKey: (row) => row.id,
        }}
        contextMenu={(row) => {
          const status = row.status;
          const items: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'Edit',    onClick: () => openDetail(row, true) },
            { label: 'View',    onClick: () => openDetail(row) },
            { label: 'Preview', onClick: () => renderPdf(row) },
            { label: 'Print',   onClick: () => renderPdf(row) },
            { divider: true as const },
          ];
          if (status !== 'CANCELLED') {
            items.push({ label: 'Cancel Invoice', danger: true, onClick: () => doCancel(row) });
          }
          if (status === 'CANCELLED') {
            items.push({
              label: 'Reopen Invoice',
              onClick: () => {
                if (!window.confirm(`Reopen ${row.invoice_number} back to Issued?`)) return;
                updateStatus.mutate({ id: row.id, status: 'SENT' });
              },
            });
          }
          return items;
        }}
      />
    </div>
  );
};

/* ── Columns — mirrors the DO list set, adapted to SI fields. ───────────── */
const buildColumns = (staffById: Map<string, string>): DataGridColumn<SiRow>[] => [
  {
    /* Status pill is shown in the dedicated Status column further right —
       don't duplicate it here (Wei Siang 2026-05-30). */
    key: 'invoice_number', label: 'Invoice No.', width: 140, sortable: true,
    accessor: (r) => (
      <span style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>{r.invoice_number}</span>
    ),
    searchValue: (r) => `${r.invoice_number} ${r.status ?? ''}`,
  },
  {
    key: 'so_doc_no', label: 'SO Ref', width: 130, sortable: true,
    accessor: (r) => r.so_doc_no ?? '—',
    searchValue: (r) => r.so_doc_no ?? '',
  },
  {
    key: 'invoice_date', label: 'Invoice Date', width: 120, sortable: true,
    accessor: (r) => compactDate(r.invoice_date),
    searchValue: (r) => `${r.invoice_date ?? ''} ${compactDate(r.invoice_date)}`,
    sortFn: (a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''),
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
    key: 'due_date', label: 'Due', width: 110, sortable: true,
    accessor: (r) => compactDate(r.due_date),
    searchValue: (r) => r.due_date ?? '',
    sortFn: (a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''),
  },
  {
    key: 'customer_so_no', label: 'Reference', width: 130, sortable: true,
    accessor: (r) => r.customer_so_no ?? r.po_doc_no ?? r.ref ?? '—',
    searchValue: (r) => `${r.customer_so_no ?? ''} ${r.po_doc_no ?? ''} ${r.ref ?? ''}`,
    sortFn: (a, b) =>
      (a.customer_so_no ?? a.po_doc_no ?? a.ref ?? '').localeCompare(b.customer_so_no ?? b.po_doc_no ?? b.ref ?? ''),
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
    key: 'local_total_centi', label: 'Invoice Total', width: 120, sortable: true, align: 'right',
    accessor: (r) => (
      <span style={{ fontWeight: 700, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(r.local_total_centi || r.total_centi || 0)}</span>
    ),
    searchValue: (r) => fmtRm(r.local_total_centi || r.total_centi || 0),
    sortFn: (a, b) => (a.local_total_centi || a.total_centi || 0) - (b.local_total_centi || b.total_centi || 0),
  },
  {
    key: 'paid_centi', label: 'Paid', width: 110, sortable: true, align: 'right',
    accessor: (r) => {
      const v = r.paid_centi ?? 0;
      if (v === 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      return <span style={{ fontWeight: 600, color: 'var(--c-secondary-a, #2F5D4F)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(v)}</span>;
    },
    searchValue: (r) => fmtRm(r.paid_centi ?? 0),
    sortFn: (a, b) => (a.paid_centi ?? 0) - (b.paid_centi ?? 0),
  },
  {
    key: 'outstanding', label: 'Outstanding', width: 120, sortable: true, align: 'right',
    accessor: (r) => {
      const out = Math.max(0, (r.total_centi ?? (r.local_total_centi || 0)) - (r.paid_centi ?? 0));
      if (out === 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      return <span style={{ fontWeight: 600, color: 'var(--c-festive-b, #B8331F)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(out)}</span>;
    },
    searchValue: (r) => fmtRm(Math.max(0, (r.total_centi ?? 0) - (r.paid_centi ?? 0))),
    sortFn: (a, b) =>
      Math.max(0, (a.total_centi ?? 0) - (a.paid_centi ?? 0)) - Math.max(0, (b.total_centi ?? 0) - (b.paid_centi ?? 0)),
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
    key: 'status', label: 'Status', width: 140, sortable: true, groupable: true,
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
    key: 'address1', label: 'Address 1', width: 180, sortable: true, defaultHidden: true,
    accessor: (r) => r.address1 ?? '',
    searchValue: (r) => r.address1 ?? '',
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
