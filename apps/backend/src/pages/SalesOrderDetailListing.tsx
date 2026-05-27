// ----------------------------------------------------------------------------
// SalesOrderDetailListing — AutoCount-style "Print Sales Order Detail Listing"
// report page at /reports/sales-order-detail-listing.
//
// One row per Sales Order LINE ITEM (with SO header info repeated). Mirrors
// the AutoCount column set the commander uses as canonical for ERP listing
// reports: 36 columns total covering doc header + line + payment + remarks
// (plus a "Check" selection column at the left).
//
// Layout:
//   1. Header: back + title
//   2. Two filter cards (side-by-side):
//      - Basic Filter (Document Date range, Doc No, Debtor Code, Item Code, Delivery Date range)
//      - Report Options (Group By, Sort By, Show Criteria, More Options, Advanced Filter)
//   3. Action bar: Inquiry · Preview · Print · Hide Options · Criteria · Close
//   4. Optional criteria summary
//   5. Search Result panel — wraps <DataGrid> (PR-G primitive) for:
//      column reorder/hide/pin via right-click, drag-to-group-by, sort,
//      resize, global search, and localStorage layout persistence
//      (storageKey: `so-detail-listing-grid`).
//
// The page-level "Group By" dropdown in the Report Options card writes
// directly into the DataGrid's layout state for parity with AutoCount, while
// drag-to-group-by from any column header still works via DataGrid's banner.
//
// ── Temporary placeholders (Task #86 follow-up) ────────────────────────────
// Malaysia is currently in a no-SST regime, so `tax_centi` is always 0 across
// every SO row. Until SST returns (and the codebase wires a real tax-code
// source) the following columns render constants:
//   - Inclusive?       → "Yes"  (a zero-tax doc is, by AutoCount convention,
//                                 "tax-inclusive at 0%")
//   - Tax (header/line) → "0.00"
//   - Detail Tax Code  → "SR"   (AutoCount's Standard-Rated 0% code)
//
// Likewise, cross-doc linking from SO line → supplier PO isn't tracked in our
// schema yet, so the following columns render "—":
//   - Creditor Code
//   - Post to PO
// Future work: add a `linked_po_doc_no` (or similar) FK on
// mfg_sales_order_items if the commander wants these populated. The PAYEMENT
// column (note: AutoCount preserved the typo) reads `paid_total_centi`,
// derived server-side from mfg_sales_order_payments (PR-C dropped the legacy
// header column).
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, ClipboardList, Printer, Eye, Filter, X,
  SlidersHorizontal, FileSearch,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import {
  useSalesOrderDetailListing,
  type SoDetailListingFilters,
  type SoDetailListingRow,
} from '../lib/flow-queries';
import styles from './SalesOrderDetailListing.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const STORAGE_KEY = 'so-detail-listing-grid';

type DateMode = 'range' | 'none';
type GroupBy = NonNullable<SoDetailListingFilters['groupBy']>;
type SortBy  = NonNullable<SoDetailListingFilters['sortBy']>;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const c = Number(centi ?? 0);
  return `${currency} ${(c / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/* ─────────────────────────────────────────────────────────────────────────
   Column factory — accepts the selection map + a toggle callback so the
   "Check" column can render an interactive checkbox per row. The remaining
   36 columns map AutoCount field-for-field. Keys are stable identifiers
   referenced by DataGrid's localStorage layout (order, hidden, widths).
   ───────────────────────────────────────────────────────────────────────── */
const buildColumns = (
  checked: Record<string, boolean>,
  onToggle: (id: string) => void,
): DataGridColumn<SoDetailListingRow>[] => [
  {
    key: 'check', label: 'Check', width: 50, align: 'left',
    sortable: false, groupable: false,
    accessor: (r) => (
      <input
        type="checkbox"
        aria-label={`Toggle ${r.doc_no} / ${r.item_code}`}
        checked={!!checked[r.id]}
        onChange={() => onToggle(r.id)}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    searchValue: () => '',
  },
  {
    key: 'doc_no', label: 'Doc. No.', width: 110, sortable: true, groupable: false,
    accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
    searchValue: (r) => r.doc_no,
  },
  {
    key: 'so_date', label: 'Date', width: 100, sortable: true,
    accessor: (r) => (r.so_date ?? r.line_date ?? '—') as string,
    searchValue: (r) => String(r.so_date ?? r.line_date ?? ''),
  },
  {
    key: 'debtor_code', label: 'Debtor Code', width: 110, sortable: true, groupable: true,
    accessor: (r) => r.debtor_code ?? '—',
    searchValue: (r) => r.debtor_code ?? '',
  },
  {
    key: 'debtor_name', label: 'Debtor Name', width: 200, sortable: true, groupable: true,
    accessor: (r) => r.debtor_name ?? '—',
    searchValue: (r) => r.debtor_name ?? '',
  },
  {
    key: 'agent', label: 'Agent', width: 110, sortable: true, groupable: true,
    accessor: (r) => r.agent ?? '—',
    searchValue: (r) => r.agent ?? '',
  },
  {
    key: 'currency', label: 'Curr. Code', width: 80, sortable: true, groupable: true,
    accessor: (r) => r.currency ?? 'MYR',
    searchValue: (r) => r.currency ?? 'MYR',
  },
  // Inclusive? — constant "Yes" while Malaysia is in the no-SST regime.
  {
    key: 'inclusive', label: 'Inclusive?', width: 80, align: 'left',
    sortable: false, groupable: false,
    accessor: () => 'Yes',
    searchValue: () => 'Yes',
  },
  {
    key: 'subtotal_ex', label: 'SubTotal (Ex)', width: 120, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0), r.currency),
    searchValue: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0), r.currency),
    sortFn: (a, b) =>
      ((a.total_centi ?? 0) - (a.tax_centi ?? 0)) -
      ((b.total_centi ?? 0) - (b.tax_centi ?? 0)),
  },
  // Tax (header) — constant 0.00 while no-SST regime is in effect.
  {
    key: 'tax_header', label: 'Tax', width: 90, align: 'right', sortable: false, groupable: false,
    accessor: (r) => fmtRm(0, r.currency),
    searchValue: (r) => fmtRm(0, r.currency),
  },
  {
    key: 'header_total', label: 'Total', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.local_total_centi ?? 0, r.currency),
    searchValue: (r) => fmtRm(r.local_total_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.local_total_centi ?? 0) - (b.local_total_centi ?? 0),
  },
  {
    key: 'local_total', label: 'Local Total', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.local_total_centi ?? 0, r.currency),
    searchValue: (r) => fmtRm(r.local_total_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.local_total_centi ?? 0) - (b.local_total_centi ?? 0),
  },
  {
    key: 'cancelled', label: 'Cancelled', width: 80, align: 'left', sortable: true, groupable: true,
    accessor: (r) => (r.cancelled ? 'Y' : 'N'),
    searchValue: (r) => (r.cancelled ? 'Y' : 'N'),
  },
  {
    key: 'remark4', label: 'Remark 4', width: 140, sortable: true,
    accessor: (r) => (r.remark4 ?? '—') as string,
    searchValue: (r) => r.remark4 ?? '',
  },
  {
    key: 'sales_exemption_expiry', label: 'Sales Exemption Expiry', width: 160, sortable: true,
    accessor: (r) => (r.sales_exemption_expiry ?? '—') as string,
    searchValue: (r) => r.sales_exemption_expiry ?? '',
  },
  {
    key: 'processing_date', label: 'Processing Date', width: 130, sortable: true,
    accessor: (r) => (r.processing_date ?? '—') as string,
    searchValue: (r) => r.processing_date ?? '',
  },
  {
    key: 'item_group', label: 'Item Group', width: 120, sortable: true, groupable: true,
    accessor: (r) => r.item_group ?? '—',
    searchValue: (r) => r.item_group ?? '',
  },
  {
    key: 'item_code', label: 'Item Code', width: 120, sortable: true, groupable: false,
    accessor: (r) => <span className={styles.codeCell}>{r.item_code}</span>,
    searchValue: (r) => r.item_code,
  },
  {
    key: 'description', label: 'Detail Description', width: 220, sortable: true,
    accessor: (r) => (r.description ?? '—') as string,
    searchValue: (r) => r.description ?? '',
  },
  {
    key: 'uom', label: 'UOM', width: 70, sortable: true, groupable: true,
    accessor: (r) => r.uom ?? '—',
    searchValue: (r) => r.uom ?? '',
  },
  {
    key: 'location', label: 'Location', width: 110, sortable: true, groupable: true,
    accessor: (r) => (r.location ?? '—') as string,
    searchValue: (r) => r.location ?? '',
  },
  {
    key: 'description2', label: 'Detail Description 2', width: 200, sortable: true,
    accessor: (r) => (r.description2 ?? '—') as string,
    searchValue: (r) => r.description2 ?? '',
  },
  {
    key: 'qty', label: 'Qty', width: 70, align: 'right', sortable: true, groupable: false,
    accessor: (r) => String(r.qty ?? 0),
    searchValue: (r) => String(r.qty ?? 0),
    sortFn: (a, b) => Number(a.qty ?? 0) - Number(b.qty ?? 0),
  },
  {
    key: 'unit_price', label: 'Unit Price', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.unit_price_centi, r.currency),
    searchValue: (r) => fmtRm(r.unit_price_centi, r.currency),
    sortFn: (a, b) => (a.unit_price_centi ?? 0) - (b.unit_price_centi ?? 0),
  },
  {
    key: 'discount', label: 'Discount', width: 100, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.discount_centi, r.currency),
    searchValue: (r) => fmtRm(r.discount_centi, r.currency),
    sortFn: (a, b) => (a.discount_centi ?? 0) - (b.discount_centi ?? 0),
  },
  // Detail Tax Code — constant "SR" while no-SST regime is in effect.
  {
    key: 'detail_tax_code', label: 'Detail Tax Code', width: 120, sortable: false, groupable: false,
    accessor: () => 'SR',
    searchValue: () => 'SR',
  },
  {
    key: 'line_total', label: 'Total', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.total_centi, r.currency),
    searchValue: (r) => fmtRm(r.total_centi, r.currency),
    sortFn: (a, b) => (a.total_centi ?? 0) - (b.total_centi ?? 0),
  },
  /* Task #114 — Cost / Margin trio. Server snapshots cost from
     mfg_products on insert; the report joins line_cost_centi + line_margin
     so the listing matches the Houzs SO Details report. Margin %
     pill color matches the Houzs ladder (≥50% emerald, ≥30% amber,
     >0 orange, ≤0 red). */
  {
    key: 'unit_cost', label: 'Unit Cost', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => (r.unit_cost_centi ?? 0) > 0 ? fmtRm(r.unit_cost_centi, r.currency) : '—',
    searchValue: (r) => fmtRm(r.unit_cost_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.unit_cost_centi ?? 0) - (b.unit_cost_centi ?? 0),
  },
  {
    key: 'line_cost', label: 'Line Cost', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => (r.line_cost_centi ?? 0) > 0 ? fmtRm(r.line_cost_centi, r.currency) : '—',
    searchValue: (r) => fmtRm(r.line_cost_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.line_cost_centi ?? 0) - (b.line_cost_centi ?? 0),
  },
  {
    key: 'line_margin', label: 'Margin', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => {
      const m = r.line_margin_centi ?? 0;
      if ((r.total_centi ?? 0) <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      const color = m > 0 ? 'var(--c-secondary-a, #2F5D4F)' : m < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
      return <span style={{ color, fontWeight: 600 }}>{fmtRm(m, r.currency)}</span>;
    },
    searchValue: (r) => fmtRm(r.line_margin_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.line_margin_centi ?? 0) - (b.line_margin_centi ?? 0),
  },
  {
    key: 'margin_pct', label: 'Margin %', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => {
      const rev = r.total_centi ?? 0;
      if (rev <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      const pct = ((r.line_margin_centi ?? 0) / rev) * 100;
      const color = pct >= 50 ? 'var(--c-secondary-a, #2F5D4F)'
        : pct >= 30 ? 'var(--c-festive-a, #C77F3E)'
        : pct > 0   ? 'var(--c-burnt)'
        : 'var(--c-festive-b, #B8331F)';
      return <span style={{
        color,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
      }}>{pct.toFixed(1)}%</span>;
    },
    searchValue: (r) => {
      const rev = r.total_centi ?? 0;
      if (rev <= 0) return '';
      return `${(((r.line_margin_centi ?? 0) / rev) * 100).toFixed(1)}%`;
    },
    sortFn: (a, b) => {
      const aPct = (a.total_centi ?? 0) > 0 ? (a.line_margin_centi ?? 0) / a.total_centi! : 0;
      const bPct = (b.total_centi ?? 0) > 0 ? (b.line_margin_centi ?? 0) / b.total_centi! : 0;
      return aPct - bPct;
    },
  },
  // Tax (line) — constant 0.00 while no-SST regime is in effect.
  {
    key: 'line_tax', label: 'Tax', width: 90, align: 'right', sortable: false, groupable: false,
    accessor: (r) => fmtRm(0, r.currency),
    searchValue: (r) => fmtRm(0, r.currency),
  },
  {
    key: 'total_ex', label: 'Total (Ex)', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0), r.currency),
    searchValue: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0), r.currency),
    sortFn: (a, b) =>
      ((a.total_centi ?? 0) - (a.tax_centi ?? 0)) -
      ((b.total_centi ?? 0) - (b.tax_centi ?? 0)),
  },
  {
    key: 'total_inc', label: 'Total (Inc)', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.total_inc_centi ?? r.total_centi ?? 0, r.currency),
    searchValue: (r) => fmtRm(r.total_inc_centi ?? r.total_centi ?? 0, r.currency),
    sortFn: (a, b) =>
      (a.total_inc_centi ?? a.total_centi ?? 0) -
      (b.total_inc_centi ?? b.total_centi ?? 0),
  },
  // Creditor Code / Post to PO — SO→PO linking not tracked yet.
  {
    key: 'creditor_code', label: 'Creditor Code', width: 110, sortable: false, groupable: false,
    accessor: () => '—',
    searchValue: () => '',
  },
  {
    key: 'post_to_po', label: 'Post to PO', width: 90, align: 'left', sortable: false, groupable: false,
    accessor: () => '—',
    searchValue: () => '',
  },
  {
    key: 'balance', label: 'BALANCE', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.balance_centi ?? 0, r.currency),
    searchValue: (r) => fmtRm(r.balance_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.balance_centi ?? 0) - (b.balance_centi ?? 0),
  },
  // PAYEMENT — AutoCount preserves the typo. Server-derived from
  // mfg_sales_order_payments (paid_total_centi).
  {
    key: 'payment', label: 'PAYEMENT', width: 110, align: 'right', sortable: true, groupable: false,
    accessor: (r) => fmtRm(r.paid_total_centi ?? 0, r.currency),
    searchValue: (r) => fmtRm(r.paid_total_centi ?? 0, r.currency),
    sortFn: (a, b) => (a.paid_total_centi ?? 0) - (b.paid_total_centi ?? 0),
  },
  {
    key: 'remark5', label: 'Remark5', width: 140, sortable: true,
    accessor: (r) => (r.remark2 ?? '—') as string,
    searchValue: (r) => r.remark2 ?? '',
  },
  {
    key: 'remark6', label: 'Remark6', width: 140, sortable: true,
    accessor: (r) => (r.remark3 ?? '—') as string,
    searchValue: (r) => r.remark3 ?? '',
  },
];

/* ─────────────────────────────────────────────────────────────────────────
   The page-level "Group By" select writes into the DataGrid's localStorage
   layout under STORAGE_KEY. Maps the SO-listing-flavoured enum to the
   underlying column key.
   ───────────────────────────────────────────────────────────────────────── */
const GROUP_TO_COL_KEY: Record<Exclude<GroupBy, 'none'>, string> = {
  branding:    'agent',       // SoDetailListingRow has no `branding` line field;
                              // fall back to agent (closest equivalent).
  agent:       'agent',
  debtor:      'debtor_code',
  item_group:  'item_group',
};

type GridLayout = {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  groupBy: string[];
  pinned: string[];
  sort: { key: string; dir: 'asc' | 'desc' } | null;
};
const setGridGroupBy = (colKey: string | null) => {
  if (typeof window === 'undefined') return;
  let layout: Partial<GridLayout> = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) layout = JSON.parse(raw) as Partial<GridLayout>;
  } catch { /* corrupt — overwrite */ }
  const next: GridLayout = {
    order:   layout.order   ?? [],
    hidden:  layout.hidden  ?? [],
    widths:  layout.widths  ?? {},
    pinned:  layout.pinned  ?? [],
    sort:    layout.sort    ?? null,
    groupBy: colKey ? [colKey] : [],
  };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
};

export const SalesOrderDetailListing = () => {
  const navigate = useNavigate();

  // ── Filter state ─────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const [docDateMode, setDocDateMode] = useState<DateMode>('range');
  const [dateFrom, setDateFrom] = useState(yearAgo);
  const [dateTo,   setDateTo]   = useState(today);
  const [docNo,       setDocNo]       = useState('');
  const [debtorCode,  setDebtorCode]  = useState('');
  const [itemCode,    setItemCode]    = useState('');
  const [deliveryDateMode, setDeliveryDateMode] = useState<DateMode>('none');
  const [deliveryFrom, setDeliveryFrom] = useState('');
  const [deliveryTo,   setDeliveryTo]   = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy,  setSortBy]  = useState<SortBy>('date');
  const [showCriteria, setShowCriteria] = useState(false);

  // ── UI state ────────────────────────────────────────────────────
  const [optionsVisible, setOptionsVisible] = useState(true);
  const [hasRunQuery,    setHasRunQuery]    = useState(false);
  const [criteriaPanel,  setCriteriaPanel]  = useState(false);
  const [checked,        setChecked]        = useState<Record<string, boolean>>({});
  const [hideUnchecked,  setHideUnchecked]  = useState(false);
  const [findNonce,      setFindNonce]      = useState(0);

  // ── Inquiry query — only fires after the user clicks "Inquiry". ──
  const [committed, setCommitted] = useState<SoDetailListingFilters>({});
  const query = useSalesOrderDetailListing(hasRunQuery ? committed : {});
  const rawRows = useMemo<SoDetailListingRow[]>(
    () => (hasRunQuery ? (query.data?.rows ?? []) : []),
    [hasRunQuery, query.data],
  );

  // Hide-unchecked filter — DataGrid handles search/sort/group, we just
  // shrink the input set when "Clear Unchecked" is toggled on.
  const rows = useMemo(() => {
    if (!hideUnchecked) return rawRows;
    return rawRows.filter((r) => checked[r.id]);
  }, [rawRows, checked, hideUnchecked]);

  /* Task #114 — Page-level KPI bar mirroring the Houzs SO Details
     report header. 6 tiles computed from the same filtered row set the
     grid renders: Total Lines, Unique Orders, Revenue, Cost, Margin
     (with %), Outstanding (deduped per docNo). */
  const kpis = useMemo(() => {
    const totalLines = rows.length;
    const uniqueDocs = new Set<string>();
    let revenue = 0;
    let cost = 0;
    /* Outstanding is a per-doc value (local_total − paid). The line-flat
       report repeats it per line, so dedupe by docNo before summing. */
    const outstandingByDoc = new Map<string, number>();
    for (const r of rows) {
      uniqueDocs.add(r.doc_no);
      revenue += r.total_centi ?? 0;
      cost    += r.line_cost_centi ?? 0;
      if (!outstandingByDoc.has(r.doc_no)) {
        const ltc = r.local_total_centi ?? 0;
        const ptc = r.paid_total_centi ?? 0;
        outstandingByDoc.set(r.doc_no, Math.max(ltc - ptc, 0));
      }
    }
    const outstanding = [...outstandingByDoc.values()].reduce((s, v) => s + v, 0);
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return { totalLines, uniqueOrders: uniqueDocs.size, revenue, cost, margin, marginPct, outstanding };
  }, [rows]);

  // ── Sync page-level Group By dropdown → DataGrid layout ─────────
  // The DataGrid reads its layout from localStorage on mount; once the user
  // changes the dropdown we patch the saved layout and bump a remount nonce
  // so the new groupBy takes effect immediately. Skip the initial mount so
  // we don't overwrite a persisted layout with the default 'none'.
  const [gridNonce, setGridNonce] = useState(0);
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    setGridGroupBy(groupBy === 'none' ? null : GROUP_TO_COL_KEY[groupBy]);
    setGridNonce((n) => n + 1);
  }, [groupBy]);

  // ── Columns ─────────────────────────────────────────────────────
  /* Task #99 (UI perf) — `toggleRow` was recreated on every parent render,
     which silently invalidated the `columns` useMemo below (dep array
     captured the unstable function via closure even though it wasn't a
     dep) and rebuilt all 37 column definitions per render. Wrap in
     useCallback with the functional setState so it's stable for the
     page's lifetime. */
  const toggleRow = useCallback(
    (id: string) => setChecked((p) => ({ ...p, [id]: !p[id] })),
    [],
  );
  const columns = useMemo<DataGridColumn<SoDetailListingRow>[]>(
    () => buildColumns(checked, toggleRow),
    [checked, toggleRow],
  );

  // ── Action handlers ─────────────────────────────────────────────
  const runInquiry = () => {
    setCommitted({
      dateFrom:         docDateMode === 'range' ? dateFrom : undefined,
      dateTo:           docDateMode === 'range' ? dateTo   : undefined,
      docNo:            docNo.trim()      || undefined,
      debtorCode:       debtorCode.trim() || undefined,
      itemCode:         itemCode.trim()   || undefined,
      deliveryDateFrom: deliveryDateMode === 'range' ? deliveryFrom : undefined,
      deliveryDateTo:   deliveryDateMode === 'range' ? deliveryTo   : undefined,
      groupBy,
      sortBy,
    });
    setHasRunQuery(true);
  };

  const runPrint = () => {
    if (!hasRunQuery) runInquiry();
    setTimeout(() => window.print(), 60);
  };

  // Same dynamic-import jspdf pattern as sales-order-pdf.ts.
  const generatePreviewPdf = async (data: SoDetailListingRow[]) => {
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
      const margin = 10;
      let y = margin;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text("Sales Order Detail Listing", margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${data.length} rows`,
        margin, y,
      );
      y += 4;
      // Representative subset of cols — A4 landscape can't show all 36.
      const previewKeys = [
        'doc_no', 'so_date', 'debtor_name', 'agent', 'item_code',
        'description', 'qty', 'unit_price', 'discount', 'line_total',
      ];
      const previewCols = previewKeys
        .map((k) => columns.find((c) => c.key === k))
        .filter((c): c is DataGridColumn<SoDetailListingRow> => Boolean(c));
      autoTable(doc, {
        startY: y + 2,
        head: [previewCols.map((c) => c.label)],
        body: data.map((r) =>
          previewCols.map((c) => {
            if (c.searchValue) return c.searchValue(r);
            const v = c.accessor(r);
            return typeof v === 'string' || typeof v === 'number' ? String(v)
                 : (r as Record<string, unknown>)[c.key] != null
                   ? String((r as Record<string, unknown>)[c.key])
                   : '';
          })
        ),
        theme: 'striped',
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
        margin: { left: margin, right: margin },
      });
      doc.save(`sales-order-detail-listing-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('PDF preview failed', e);
      alert(`PDF preview failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runPreview = async () => {
    if (!hasRunQuery) {
      runInquiry();
      setTimeout(() => { void generatePreviewPdf(rows); }, 250);
      return;
    }
    await generatePreviewPdf(rows);
  };

  // ── Selection helpers ──────────────────────────────────────────
  const checkAll = () => {
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.id] = true;
    setChecked(next);
  };
  const uncheckAll = () => setChecked({});
  const uncheckInSelection = () => {
    const next = { ...checked };
    for (const r of rows) if (next[r.id]) next[r.id] = false;
    setChecked(next);
  };
  const clearUnchecked = () => setHideUnchecked((p) => !p);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className={`${styles.page} ${optionsVisible ? '' : styles.optionsHidden}`}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </button>
          <div>
            <h1 className={styles.title}>
              <ClipboardList size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              Sales Order Detail Listing
            </h1>
            <p className={styles.subtitle}>
              AutoCount-style report · one row per Sales Order line item
            </p>
          </div>
        </div>
      </div>

      {/* Task #114 — 6 KPI tiles at the top mirroring the Houzs SO Details
          report header. Always rendered (zeros before Inquiry runs).
          Values recompute from the same filtered row set the grid sees. */}
      {hasRunQuery && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 'var(--space-2)',
        }}>
          {([
            { label: 'Total Lines',    value: kpis.totalLines.toString() },
            { label: 'Unique Orders',  value: kpis.uniqueOrders.toString() },
            { label: 'Revenue',        value: fmtRm(kpis.revenue) },
            { label: 'Cost',           value: fmtRm(kpis.cost) },
            { label: 'Margin',         value: `${fmtRm(kpis.margin)}${kpis.revenue > 0 ? ` (${kpis.marginPct.toFixed(1)}%)` : ''}`,
              accent: kpis.margin > 0 ? 'good' as const : kpis.margin < 0 ? 'bad' as const : null },
            { label: 'Outstanding',    value: fmtRm(kpis.outstanding),
              accent: kpis.outstanding > 0 ? 'bad' as const : null },
          ]).map(({ label, value, accent }) => (
            <div key={label} className={styles.card} style={{
              padding: 'var(--space-2) var(--space-3)',
            }}>
              <div className={styles.cardTitle} style={{ borderBottom: 'none', padding: 0, fontSize: 'var(--fs-10)' }}>
                {label}
              </div>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: 'var(--fs-14)',
                fontVariantNumeric: 'tabular-nums',
                color: accent === 'good' ? 'var(--c-secondary-a, #2F5D4F)'
                  : accent === 'bad' ? 'var(--c-festive-b, #B8331F)'
                  : 'var(--c-ink)',
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filter cards (top) ──────────────────────────────────── */}
      {optionsVisible && (
        <div className={styles.filterRow}>
          {/* Basic Filter */}
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Basic Filter</h2>
            </header>
            <div className={styles.cardBody}>
              <div className={styles.filterGrid}>
                {/* Document Date */}
                <div className={`${styles.field} ${styles.filterGridSpan2}`}>
                  <label className={styles.fieldLabel}>Document Date</label>
                  <div className={styles.dateRangeRow}>
                    <select
                      className={styles.fieldSelect}
                      value={docDateMode}
                      onChange={(e) => setDocDateMode(e.target.value as DateMode)}
                    >
                      <option value="range">Filter by range</option>
                      <option value="none">No filter</option>
                    </select>
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      disabled={docDateMode !== 'range'}
                    />
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      disabled={docDateMode !== 'range'}
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Document No</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={docNo}
                    onChange={(e) => setDocNo(e.target.value)}
                    placeholder="SO-009001"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Debtor Code</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={debtorCode}
                    onChange={(e) => setDebtorCode(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Item Code</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value)}
                  />
                </div>

                {/* Delivery Date */}
                <div className={`${styles.field} ${styles.filterGridSpan2}`}>
                  <label className={styles.fieldLabel}>Delivery Date</label>
                  <div className={styles.dateRangeRow}>
                    <select
                      className={styles.fieldSelect}
                      value={deliveryDateMode}
                      onChange={(e) => setDeliveryDateMode(e.target.value as DateMode)}
                    >
                      <option value="none">No filter</option>
                      <option value="range">Filter by range</option>
                    </select>
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={deliveryFrom}
                      onChange={(e) => setDeliveryFrom(e.target.value)}
                      disabled={deliveryDateMode !== 'range'}
                    />
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={deliveryTo}
                      onChange={(e) => setDeliveryTo(e.target.value)}
                      disabled={deliveryDateMode !== 'range'}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Report Options */}
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Report Options</h2>
            </header>
            <div className={`${styles.cardBody} ${styles.optionsBody}`}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Group By</label>
                <select
                  className={styles.fieldSelect}
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                >
                  <option value="none">None</option>
                  <option value="branding">Branding</option>
                  <option value="agent">Agent</option>
                  <option value="debtor">Debtor</option>
                  <option value="item_group">Item Group</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Sort By</label>
                <select
                  className={styles.fieldSelect}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                >
                  <option value="date">Date</option>
                  <option value="doc_no">Doc No</option>
                  <option value="item_code">Item Code</option>
                </select>
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={showCriteria}
                  onChange={(e) => setShowCriteria(e.target.checked)}
                />
                <span>Show Criteria In Report</span>
              </label>
              <div className={styles.optionsButtonRow}>
                <Button variant="ghost" size="sm" onClick={() => alert('More Options — coming soon')}>
                  <SlidersHorizontal {...SM_ICON} />
                  <span>More Options</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => alert('Advanced Filter — coming soon')}>
                  <Filter {...SM_ICON} />
                  <span>Advanced Filter</span>
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Action bar ─────────────────────────────────────────── */}
      <div className={styles.actionBar}>
        <Button variant="primary" size="sm" onClick={runInquiry}>
          <FileSearch {...SM_ICON} />
          <span>Inquiry</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={runPreview}>
          <Eye {...SM_ICON} />
          <span>Preview</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={runPrint}>
          <Printer {...SM_ICON} />
          <span>Print</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOptionsVisible((v) => !v)}
        >
          <span>{optionsVisible ? 'Hide Options' : 'Show Options'}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCriteriaPanel((p) => !p)}>
          <span>Criteria</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <X {...SM_ICON} />
          <span>Close</span>
        </Button>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {query.isFetching ? 'Loading…' : hasRunQuery ? `${rawRows.length} line items` : 'Set filters and press Inquiry'}
        </span>
      </div>

      {/* ── Criteria summary (toggleable + always shown if Show Criteria) */}
      {(criteriaPanel || showCriteria) && (
        <div className={styles.criteriaBox}>
          <div>
            <div className={styles.criteriaKey}>Document Date</div>
            <div>{docDateMode === 'range' ? `${dateFrom} → ${dateTo}` : 'No filter'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Doc No</div>
            <div>{docNo || '—'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Debtor Code</div>
            <div>{debtorCode || '—'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Item Code</div>
            <div>{itemCode || '—'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Delivery Date</div>
            <div>{deliveryDateMode === 'range' ? `${deliveryFrom || '—'} → ${deliveryTo || '—'}` : 'No filter'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Group / Sort</div>
            <div>{groupBy} · {sortBy}</div>
          </div>
        </div>
      )}

      {/* ── Search Result — DataGrid primitive ──────────────────── */}
      <section className={styles.resultCard}>
        <header className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>
            <ClipboardList size={14} strokeWidth={1.75} />
            Search Result
          </h2>
          <div className={styles.checkboxButtonRow}>
            <Button variant="ghost" size="sm" onClick={checkAll}>Check All</Button>
            <Button variant="ghost" size="sm" onClick={uncheckAll}>Uncheck All</Button>
            <Button variant="ghost" size="sm" onClick={uncheckInSelection}>Uncheck In Selection</Button>
            <Button variant="ghost" size="sm" onClick={clearUnchecked}>
              {hideUnchecked ? 'Show All' : 'Clear Unchecked'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFindNonce((n) => n + 1)}>
              Find
            </Button>
          </div>
        </header>

        <DataGrid<SoDetailListingRow>
          key={gridNonce /* remount on Group By dropdown change so layout reload picks up new groupBy */}
          rows={rows}
          columns={columns}
          storageKey={STORAGE_KEY}
          rowKey={(r) => r.id}
          searchPlaceholder="Search rows…"
          focusSearchNonce={findNonce}
          isLoading={hasRunQuery && query.isFetching && rawRows.length === 0}
          emptyMessage={
            !hasRunQuery
              ? 'Press Inquiry to run the report.'
              : 'No rows match the current filters.'
          }
        />
      </section>
    </div>
  );
};

// Re-export the column key list (for tests / debug)
export const COL_KEYS: string[] = [
  'check',
  'doc_no', 'so_date', 'debtor_code', 'debtor_name', 'agent', 'currency',
  'inclusive', 'subtotal_ex', 'tax_header', 'header_total', 'local_total',
  'cancelled', 'remark4', 'sales_exemption_expiry', 'processing_date',
  'item_group', 'item_code', 'description', 'uom', 'location', 'description2',
  'qty', 'unit_price', 'discount', 'detail_tax_code', 'line_total',
  /* Task #114 — cost trio inserted right after line_total. */
  'unit_cost', 'line_cost', 'line_margin', 'margin_pct',
  'line_tax',
  'total_ex', 'total_inc', 'creditor_code', 'post_to_po', 'balance', 'payment',
  'remark5', 'remark6',
];
