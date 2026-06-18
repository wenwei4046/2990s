// ----------------------------------------------------------------------------
// DeliveryOrderDetailListing — Task #120 L2 page for Delivery Orders.
// One row per delivery_order_items line, with the DO header denormalised.
//
// 2026-06-16 — migrated off the legacy DetailListingShell (AutoCount-style
// two-card "Basic Filter" + Inquiry/Preview/Print bar) to the same shared
// ColumnFilterBar layout as SalesOrderDetailListing: a single horizontal
// filter row (funnel · quick search · add-a-column enum/date/text chips) with
// the query auto-running on mount and KPI tiles scoped to the filtered rows.
// The page is now standalone (no shell), mirroring the SO L2 page; SI / DR
// still use DetailListingShell.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ClipboardList, Printer } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useColumnFilter, type FilterColumn } from '../components/ColumnFilterBar';
import { useDeliveryOrderDetailListing, type DetailListingRow, type DetailListingFilters } from '../lib/flow-queries';
import styles from './SalesOrderDetailListing.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

/* DataGrid column-layout persistence key — unchanged from the shell era so
   operators keep their saved DO column order/visibility. */
const STORAGE_KEY = 'do-detail-listing-grid';

/* DO doc statuses that count as "settled" — used both by the Not-Delivered
   KPI and the ?outstanding=1 overlay so the two stay in lockstep. */
const SETTLED_DO_STATUS = new Set(['DELIVERED', 'INVOICED', 'CANCELLED']);

type DoRow = DetailListingRow & {
  do_number?: string;
  so_doc_no?: string | null;
  do_date?: string | null;
  expected_delivery_at?: string | null;
  driver_name?: string | null;
  vehicle?: string | null;
  m3_milli?: number;
  city?: string | null;
  state?: string | null;
  line_total_centi?: number;
  discount_centi?: number;
  uom?: string;
  item_group?: string | null;
};

const fmtRm = (centi: number | null | undefined): string => {
  const c = Number(centi ?? 0);
  return `MYR ${(c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtM3 = (milli: number | null | undefined): string =>
  ((Number(milli ?? 0)) / 1000).toFixed(3);

/* Column-aware filter config for the DO Detail Listing. Mirrors the SO Detail
   Listing pattern (SalesOrderDetailListing.tsx) so the operator sees a
   consistent add-a-column filter across every L2 listing. enum options derive
   from the data; date columns get presets + a custom range. Accessors use the
   page's real DoRow field names. */
const DO_DETAIL_FILTER_COLUMNS: FilterColumn<DoRow>[] = [
  { key: 'doc_no',      label: 'DO No',        type: 'text', accessor: (r) => r.doc_no },
  { key: 'so_doc_no',   label: 'Transfer From (SO)', type: 'text', accessor: (r) => r.so_doc_no },
  { key: 'debtor_code', label: 'Debtor Code',  type: 'text', accessor: (r) => r.debtor_code },
  { key: 'debtor_name', label: 'Customer',     type: 'text', accessor: (r) => r.debtor_name },
  { key: 'item_code',   label: 'Item Code',    type: 'text', accessor: (r) => r.item_code },
  { key: 'driver_name', label: 'Driver',       type: 'enum', accessor: (r) => r.driver_name },
  { key: 'vehicle',     label: 'Vehicle',      type: 'enum', accessor: (r) => r.vehicle },
  { key: 'city',        label: 'City',         type: 'enum', accessor: (r) => r.city },
  { key: 'state',       label: 'State',        type: 'enum', accessor: (r) => r.state },
  { key: 'item_group',  label: 'Item Group',   type: 'enum', accessor: (r) => r.item_group },
  { key: 'uom',         label: 'UOM',          type: 'enum', accessor: (r) => r.uom },
  { key: 'status',      label: 'Status',       type: 'enum', accessor: (r) => r.status },
  { key: 'do_date',     label: 'Document Date', type: 'date', accessor: (r) => (r.do_date ?? r.line_date) as string | null },
  { key: 'expected_delivery_at', label: 'Expected Date', type: 'date', accessor: (r) => r.expected_delivery_at },
];
const DO_DETAIL_QUICK_SEARCH_KEYS = ['doc_no', 'so_doc_no', 'debtor_name', 'item_code', 'driver_name', 'city'];

export const DeliveryOrderDetailListing = () => {
  const navigate = useNavigate();

  /* Task #120 — `?outstanding=1` URL param applied to the row set. For DOs
     "outstanding" is doc-level (no payment ledger): a DO whose status hasn't
     reached DELIVERED / INVOICED (and isn't CANCELLED). Same param used on the
     L1 list and across all SO-family modules. */
  const [searchParams, setSearchParams] = useSearchParams();
  const outstandingOnly = searchParams.get('outstanding') === '1';
  const clearOutstanding = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('outstanding');
    setSearchParams(next, { replace: true });
  };

  /* ── Server-side query — auto-runs (matches the SO L2 page; data shows
        immediately). Date-range filtering is now client-side via the
        column-aware filter bar, so we fetch the full result set with no
        server filters. */
  const committed: DetailListingFilters = useMemo(() => ({}), []);
  const query = useDeliveryOrderDetailListing(committed);
  const rawRows = useMemo<DoRow[]>(() => (query.data?.rows ?? []) as DoRow[], [query.data]);

  /* Apply the outstanding-only overlay before handing rows to the shared
     ColumnFilterBar. Drop lines whose document status is already settled. */
  const baseRows = useMemo<DoRow[]>(() => {
    if (!outstandingOnly) return rawRows;
    return rawRows.filter((r) => !SETTLED_DO_STATUS.has(String(r.status ?? '')));
  }, [rawRows, outstandingOnly]);

  /* Column-aware filter (shared ColumnFilterBar): free-text quick search +
     add-a-column filters (enum / date presets + range / text). Replaces the
     old AutoCount-style Basic Filter card (Document Date range · Document No ·
     Debtor Code · Item Code) gated behind the Inquiry button. The
     outstanding-only toggle still flows via ?outstanding=1 and applies on top
     of the column filters. */
  const { rows: filteredRows, bar: filterBar } = useColumnFilter<DoRow>({
    allRows: baseRows,
    columns: DO_DETAIL_FILTER_COLUMNS,
    quickSearchKeys: DO_DETAIL_QUICK_SEARCH_KEYS,
    quickSearchPlaceholder: 'DO No, SO ref, customer, SKU, driver, city…',
    storageKey: 'pr-g.do-detail-listing.filters.v1',
    totalCount: rawRows.length,
    loading: query.isFetching,
  });

  /* Selection state for the leading "Check" column (mirrors the shell). */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const onToggle = (id: string) => setChecked((p) => ({ ...p, [id]: !p[id] }));

  const columns = useMemo<DataGridColumn<DoRow>[]>(() => [
    {
      key: 'check', label: 'Check', width: 50, align: 'left', sortable: false, groupable: false,
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
      key: 'doc_no', label: 'DO No.', width: 120, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
      searchValue: (r) => r.doc_no,
    },
    {
      key: 'do_date', label: 'Date', width: 100, sortable: true,
      accessor: (r) => fmtDateOrDash((r.do_date ?? r.line_date) as string | null),
      searchValue: (r) => String(r.do_date ?? r.line_date ?? ''),
      filterType: 'date', dateValue: (r) => (r.do_date ?? r.line_date) as string | null,
    },
    {
      key: 'so_doc_no', label: 'Transfer From (SO)', width: 110, sortable: true, groupable: true,
      accessor: (r) => r.so_doc_no ?? '—',
      searchValue: (r) => r.so_doc_no ?? '',
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
      key: 'driver_name', label: 'Driver', width: 140, sortable: true, groupable: true,
      accessor: (r) => r.driver_name ?? '—',
      searchValue: (r) => r.driver_name ?? '',
    },
    {
      key: 'vehicle', label: 'Vehicle', width: 110, sortable: true,
      accessor: (r) => (r.vehicle ?? '—') as string,
      searchValue: (r) => r.vehicle ?? '',
    },
    {
      key: 'city', label: 'City', width: 130, sortable: true, groupable: true,
      accessor: (r) => r.city ?? '—',
      searchValue: (r) => r.city ?? '',
    },
    {
      key: 'state', label: 'State', width: 130, sortable: true, groupable: true,
      accessor: (r) => r.state ?? '—',
      searchValue: (r) => r.state ?? '',
    },
    {
      key: 'expected_delivery_at', label: 'Expected', width: 110, sortable: true,
      accessor: (r) => fmtDateOrDash(r.expected_delivery_at ?? null),
      searchValue: (r) => r.expected_delivery_at ?? '',
      filterType: 'date', dateValue: (r) => r.expected_delivery_at,
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
      key: 'item_group', label: 'Item Group', width: 110, sortable: true, groupable: true,
      accessor: (r) => r.item_group ?? '—',
      searchValue: (r) => r.item_group ?? '',
    },
    {
      key: 'uom', label: 'UOM', width: 70, sortable: true, groupable: true,
      accessor: (r) => r.uom ?? '—',
      searchValue: (r) => r.uom ?? '',
    },
    {
      key: 'qty', label: 'Qty', width: 70, align: 'right', sortable: true,
      accessor: (r) => String(r.qty ?? 0),
      searchValue: (r) => String(r.qty ?? 0),
      sortFn: (a, b) => Number(a.qty ?? 0) - Number(b.qty ?? 0),
    },
    {
      key: 'm3_milli', label: 'm³', width: 80, align: 'right', sortable: true,
      accessor: (r) => fmtM3(r.m3_milli),
      searchValue: (r) => fmtM3(r.m3_milli),
      sortFn: (a, b) => Number(a.m3_milli ?? 0) - Number(b.m3_milli ?? 0),
    },
    {
      key: 'unit_price', label: 'Unit Price', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.unit_price_centi),
      searchValue: (r) => fmtRm(r.unit_price_centi),
      sortFn: (a, b) => Number(a.unit_price_centi ?? 0) - Number(b.unit_price_centi ?? 0),
    },
    {
      key: 'discount', label: 'Discount', width: 100, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.discount_centi),
      searchValue: (r) => fmtRm(r.discount_centi),
      sortFn: (a, b) => Number(a.discount_centi ?? 0) - Number(b.discount_centi ?? 0),
    },
    {
      key: 'line_total', label: 'Line Total', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.total_centi),
      searchValue: (r) => fmtRm(r.total_centi),
      sortFn: (a, b) => Number(a.total_centi ?? 0) - Number(b.total_centi ?? 0),
    },
    {
      key: 'status', label: 'Status', width: 120, sortable: true, groupable: true,
      accessor: (r) => (r.status ? String(r.status).replace(/_/g, ' ') : '—'),
      searchValue: (r) => r.status ?? '',
    },
  ], [checked]);

  /* ── KPI tiles — computed off the filtered row set, NOT rawRows, so
        narrowing the filters re-scopes the headline numbers (matches the SO
        L2 page). Delivery Orders have no payment ledger — "Not Delivered" is
        doc-level: the sum of LINE totals per doc whose status is still
        in-flight (not DELIVERED / INVOICED / CANCELLED). */
  const kpis = useMemo(() => {
    const totalLines = filteredRows.length;
    const uniqueDocs = new Set<string>();
    let revenue = 0;
    const docStatuses = new Map<string, string>();
    for (const r of filteredRows) {
      uniqueDocs.add(r.doc_no);
      revenue += Number(r.total_centi ?? 0);
      docStatuses.set(r.doc_no, String(r.status ?? ''));
    }
    const outstandingByDoc = new Map<string, number>();
    for (const r of filteredRows) {
      const status = docStatuses.get(r.doc_no) ?? '';
      if (SETTLED_DO_STATUS.has(status)) continue;
      const cur = outstandingByDoc.get(r.doc_no) ?? 0;
      outstandingByDoc.set(r.doc_no, cur + Number(r.total_centi ?? 0));
    }
    const outstanding = [...outstandingByDoc.values()].reduce((s, v) => s + v, 0);
    return { totalLines, uniqueDocs: uniqueDocs.size, revenue, outstanding };
  }, [filteredRows]);

  const [findNonce, setFindNonce] = useState(0);
  const runPrint = () => window.print();

  useEffect(() => {
    document.title = `Delivery Order Details · ${kpis.totalLines} items`;
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
              Delivery Order Detail Listing
              {outstandingOnly && <span style={{ color: 'var(--c-burnt)', marginLeft: 8 }}>· Not delivered only</span>}
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

      {/* ── 4 KPI tiles (always rendered, scoped to current filters) ─
          DOs have no cost/margin, so we show Total Lines · Unique DOs ·
          Revenue · Not Delivered (matches the prior shell config:
          hideKpis cost+margin, uniqueDocs→"Unique DOs",
          outstanding→"Not Delivered"). */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-2)',
      }}>
        {([
          { label: 'Total Lines',   value: kpis.totalLines.toString() },
          { label: 'Unique DOs',    value: kpis.uniqueDocs.toString() },
          { label: 'Revenue (RM)',  value: fmtRm(kpis.revenue) },
          { label: 'Not Delivered (RM)', value: fmtRm(kpis.outstanding),
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
          add-a-column filters). Replaces the old AutoCount-style Basic Filter
          card + Inquiry/Preview/Print action bar. */}
      {filterBar}

      {/* ── DataGrid ─────────────────────────────────────────────── */}
      <section className={styles.resultCard}>
        <DataGrid<DoRow>
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
