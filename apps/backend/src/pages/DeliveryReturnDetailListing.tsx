// ----------------------------------------------------------------------------
// DeliveryReturnDetailListing — Task #120 L2 page for Delivery Returns.
// One row per delivery_return_items line, with the DR header denormalised.
// "Outstanding" here means the return hasn't been settled
// (status is not REFUNDED / CREDIT_NOTED / REJECTED).
//
// 2026-06-16 — migrated off DetailListingShell to the standalone layout +
// shared ColumnFilterBar, matching SalesOrderDetailListing exactly: header +
// KPI tiles + a column-aware quick-search/add-a-column filter row (replacing
// the old AutoCount "Basic Filter" card + Inquiry button the shell provided).
// The query now auto-runs on mount (Houzs-style) and all narrowing is
// client-side via the filter bar. The ?outstanding=1 overlay is preserved.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ClipboardList, Printer } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useColumnFilter, type FilterColumn } from '../components/ColumnFilterBar';
import {
  useDeliveryReturnDetailListing,
  type DetailListingFilters,
  type DetailListingRow,
} from '../lib/flow-queries';
import styles from './SalesOrderDetailListing.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

/* Stable DataGrid layout key — unchanged from the shell era so any existing
   column reorder/hide layout carries over. */
const STORAGE_KEY = 'dr-detail-listing-grid';

type DrRow = DetailListingRow & {
  return_number?: string;
  return_date?: string | null;
  reason?: string | null;
  delivery_order_id?: string | null;
  sales_invoice_id?: string | null;
  received_at?: string | null;
  inspected_at?: string | null;
  refunded_at?: string | null;
  qty_returned?: number;
  condition?: string | null;
  line_refund_centi?: number;
  refund_centi_header?: number;
};

const fmtRm = (centi: number | null | undefined): string => {
  const c = Number(centi ?? 0);
  return `MYR ${(c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* Column-aware filter config for the DR Detail Listing. Mirrors the SO Detail
   Listing pattern so the operator sees a consistent add-a-column filter across
   every L2 listing. enum options derive from the data; date columns get
   presets + a custom range. Accessors use this page's real row fields
   (delivery_return_items line + denormalised delivery_returns header). */
const DR_DETAIL_FILTER_COLUMNS: FilterColumn<DrRow>[] = [
  { key: 'doc_no',      label: 'Return No.',     type: 'text', accessor: (r) => r.doc_no },
  { key: 'debtor_code', label: 'Debtor Code',    type: 'text', accessor: (r) => r.debtor_code ?? '' },
  { key: 'debtor_name', label: 'Customer',       type: 'text', accessor: (r) => r.debtor_name ?? '' },
  { key: 'item_code',   label: 'Item Code',      type: 'text', accessor: (r) => r.item_code },
  { key: 'reason',      label: 'Reason',         type: 'enum', accessor: (r) => r.reason ?? '' },
  { key: 'condition',   label: 'Condition',      type: 'enum', accessor: (r) => r.condition ?? '' },
  { key: 'status',      label: 'Status',         type: 'enum', accessor: (r) => r.status ?? '' },
  { key: 'return_date', label: 'Return Date',    type: 'date', accessor: (r) => (r.return_date ?? r.line_date) as string | null },
  { key: 'received_at', label: 'Received Date',  type: 'date', accessor: (r) => (r.received_at ? String(r.received_at).slice(0, 10) : null) },
  { key: 'refunded_at', label: 'Refunded Date',  type: 'date', accessor: (r) => (r.refunded_at ? String(r.refunded_at).slice(0, 10) : null) },
];
const DR_DETAIL_QUICK_SEARCH_KEYS = ['doc_no', 'debtor_name', 'debtor_code', 'item_code', 'reason'];

export const DeliveryReturnDetailListing = () => {
  const navigate = useNavigate();
  /* ?outstanding=1 overlay — same param used on the L1 list and across all
     SO/DO/SI/DR-family modules. A return is "outstanding" while its balance
     (pending payout) is > 0 (status not yet REFUNDED / CREDIT_NOTED /
     REJECTED — computed server-side into balance_centi). */
  const [searchParams, setSearchParams] = useSearchParams();
  const outstandingOnly = searchParams.get('outstanding') === '1';
  const clearOutstanding = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('outstanding');
    setSearchParams(next, { replace: true });
  };

  /* Per-row selection state for the Check column. */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const onToggle = useCallback((id: string) => setChecked((p) => ({ ...p, [id]: !p[id] })), []);

  /* ── Server-side query — auto-runs (Houzs shows data immediately). Date /
        doc / debtor / item filtering is now client-side via the shared
        ColumnFilterBar, so we fetch the full result set with no committed
        filters and narrow in the browser. */
  const committed: DetailListingFilters = useMemo(() => ({}), []);
  const query = useDeliveryReturnDetailListing(committed);
  const rawRows = useMemo<DrRow[]>(() => (query.data?.rows ?? []) as DrRow[], [query.data]);

  /* Apply the outstanding-only overlay before handing rows to the shared
     ColumnFilterBar — keep only rows whose return has balance > 0. */
  const baseRows = useMemo<DrRow[]>(() => {
    if (!outstandingOnly) return rawRows;
    return rawRows.filter((r) => Number(r.balance_centi ?? 0) > 0);
  }, [rawRows, outstandingOnly]);

  /* Column-aware filter (shared ColumnFilterBar): free-text quick search +
     add-a-column filters (enum / date presets + range / text). Replaces the
     old AutoCount Basic-Filter card (date range · doc no · debtor · item) +
     Inquiry button the shell hosted. The outstanding-only toggle still flows
     via ?outstanding=1 and applies on top of the column filters. */
  const { rows: filteredRows, bar: filterBar } = useColumnFilter<DrRow>({
    allRows: baseRows,
    columns: DR_DETAIL_FILTER_COLUMNS,
    quickSearchKeys: DR_DETAIL_QUICK_SEARCH_KEYS,
    quickSearchPlaceholder: 'Return No, customer, SKU, reason…',
    storageKey: 'pr-g.dr-detail-listing.filters.v1',
    totalCount: rawRows.length,
    loading: query.isFetching,
  });

  /* Columns built per render so the Check column can read selection state.
     Kept as a factory (like the shell did) because the checkbox column needs
     `checked` / `onToggle`. */
  const buildColumns = useCallback((opts: { checked: Record<string, boolean>; onToggle: (id: string) => void }): DataGridColumn<DrRow>[] => [
    {
      key: 'check', label: 'Check', width: 50, align: 'left', sortable: false, groupable: false,
      accessor: (r) => (
        <input type="checkbox" aria-label={`Toggle ${r.doc_no} / ${r.item_code}`}
          checked={!!opts.checked[r.id]} onChange={() => opts.onToggle(r.id)}
          onClick={(e) => e.stopPropagation()} />
      ),
      searchValue: () => '',
    },
    {
      key: 'doc_no', label: 'Return No.', width: 120, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
      searchValue: (r) => r.doc_no,
    },
    {
      key: 'return_date', label: 'Date', width: 100, sortable: true,
      accessor: (r) => fmtDateOrDash((r.return_date ?? r.line_date) as string | null),
      searchValue: (r) => String(r.return_date ?? r.line_date ?? ''),
      filterType: 'date', dateValue: (r) => (r.return_date ?? r.line_date) as string | null,
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
      key: 'reason', label: 'Reason', width: 200, sortable: true, groupable: true,
      accessor: (r) => r.reason ?? '—',
      searchValue: (r) => r.reason ?? '',
    },
    {
      key: 'item_code', label: 'Item Code', width: 120, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.item_code}</span>,
      searchValue: (r) => r.item_code,
    },
    {
      key: 'description', label: 'Description', width: 240, sortable: true,
      accessor: (r) => (r.description ?? '—') as string,
      searchValue: (r) => r.description ?? '',
    },
    {
      key: 'condition', label: 'Condition', width: 110, sortable: true, groupable: true,
      accessor: (r) => r.condition ?? '—',
      searchValue: (r) => r.condition ?? '',
    },
    {
      key: 'qty_returned', label: 'Qty Returned', width: 100, align: 'right', sortable: true,
      accessor: (r) => String(r.qty_returned ?? 0),
      searchValue: (r) => String(r.qty_returned ?? 0),
      sortFn: (a, b) => Number(a.qty_returned ?? 0) - Number(b.qty_returned ?? 0),
    },
    {
      key: 'unit_price', label: 'Unit Price', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.unit_price_centi),
      searchValue: (r) => fmtRm(r.unit_price_centi),
      sortFn: (a, b) => Number(a.unit_price_centi ?? 0) - Number(b.unit_price_centi ?? 0),
    },
    {
      key: 'line_refund', label: 'Line Refund', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.line_refund_centi ?? r.total_centi),
      searchValue: (r) => fmtRm(r.line_refund_centi ?? r.total_centi),
      sortFn: (a, b) => Number(a.line_refund_centi ?? a.total_centi ?? 0) - Number(b.line_refund_centi ?? b.total_centi ?? 0),
    },
    {
      key: 'received_at', label: 'Received', width: 130, sortable: true,
      accessor: (r) => fmtDateOrDash(r.received_at ?? null),
      searchValue: (r) => r.received_at ? String(r.received_at).slice(0, 10) : '',
      filterType: 'date', dateValue: (r) => r.received_at,
    },
    {
      key: 'refunded_at', label: 'Refunded', width: 130, sortable: true,
      accessor: (r) => fmtDateOrDash(r.refunded_at ?? null),
      searchValue: (r) => r.refunded_at ? String(r.refunded_at).slice(0, 10) : '',
      filterType: 'date', dateValue: (r) => r.refunded_at,
    },
    {
      key: 'balance', label: 'Pending Refund', width: 130, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.balance_centi),
      searchValue: (r) => fmtRm(r.balance_centi),
      sortFn: (a, b) => Number(a.balance_centi ?? 0) - Number(b.balance_centi ?? 0),
    },
    {
      key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
      accessor: (r) => (r.status ? String(r.status).replace(/_/g, ' ') : '—'),
      searchValue: (r) => r.status ?? '',
    },
  ], []);

  const columns = useMemo(() => buildColumns({ checked, onToggle }), [buildColumns, checked, onToggle]);

  /* ── KPI tiles — computed off the filtered row set, NOT rawRows, so
        narrowing the filters re-scopes the headline numbers (matches the SO
        page's interactive feel). A return has no cost/margin, so we surface
        Total Lines · Unique Returns · Refund Value · Pending Refund.
        Pending Refund is deduped per docNo since the line-flat row format
        repeats the header balance per line. */
  const kpis = useMemo(() => {
    const totalLines = filteredRows.length;
    const uniqueDocs = new Set<string>();
    let refundValue = 0;
    const outstandingByDoc = new Map<string, number>();
    for (const r of filteredRows) {
      uniqueDocs.add(r.doc_no);
      refundValue += Number(r.total_centi ?? 0);
      if (!outstandingByDoc.has(r.doc_no)) {
        outstandingByDoc.set(r.doc_no, Number(r.balance_centi ?? 0));
      }
    }
    const outstanding = [...outstandingByDoc.values()].reduce((s, v) => s + v, 0);
    return { totalLines, uniqueReturns: uniqueDocs.size, refundValue, outstanding };
  }, [filteredRows]);

  /* DataGrid "Focus search box" nonce (parity with the SO page). */
  const [findNonce, setFindNonce] = useState(0);

  const runPrint = () => window.print();

  useEffect(() => {
    document.title = `Delivery Return Details · ${kpis.totalLines} items`;
    return () => { document.title = '2990s'; };
  }, [kpis.totalLines]);

  return (
    <div className={styles.page}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </button>
          <div>
            <h1 className={styles.title}>
              <ClipboardList size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              Delivery Return Detail Listing
              {outstandingOnly && <span style={{ color: 'var(--c-burnt)', marginLeft: 8 }}>· Outstanding only</span>}
            </h1>
            {outstandingOnly && (
              <p className={styles.subtitle}>
                <button type="button" onClick={clearOutstanding}
                  style={{ background: 'transparent', border: 'none', color: 'var(--c-burnt)',
                    cursor: 'pointer', textDecoration: 'underline', font: 'inherit', padding: 0 }}>
                  Clear outstanding filter
                </button>
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="sm" onClick={runPrint}>
            <Printer {...SM_ICON} />
            <span>Print</span>
          </Button>
        </div>
      </div>

      {/* ── 4 KPI tiles (always rendered, scoped to current filters) ─ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-2)',
      }}>
        {([
          { label: 'Total Lines',       value: kpis.totalLines.toString() },
          { label: 'Unique Returns',    value: kpis.uniqueReturns.toString() },
          { label: 'Refund Value (RM)', value: fmtRm(kpis.refundValue) },
          { label: 'Pending Refund (RM)', value: fmtRm(kpis.outstanding),
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
              color: accent === 'bad' ? 'var(--c-festive-b, #B8331F)' : 'var(--c-ink)',
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Column-aware filter row — shared ColumnFilterBar (quick search +
          add-a-column filters). Replaces the old AutoCount Basic-Filter card
          (date range · doc no · debtor · item) + Inquiry button. */}
      {filterBar}

      {/* ── DataGrid ─────────────────────────────────────────────── */}
      <section className={styles.resultCard}>
        <DataGrid<DrRow>
          rows={filteredRows}
          columns={columns}
          storageKey={STORAGE_KEY}
          rowKey={(r) => r.id}
          searchPlaceholder="Search rows…"
          focusSearchNonce={findNonce}
          groupBanner={false}
          isLoading={query.isFetching && rawRows.length === 0}
          emptyMessage={query.isFetching ? 'Loading…' : 'No rows match the current filters.'}
          contextMenu={() => [
            { label: 'Focus search box', onClick: () => setFindNonce((n) => n + 1) },
          ]}
        />
      </section>
    </div>
  );
};
