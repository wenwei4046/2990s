// ----------------------------------------------------------------------------
// SalesInvoiceDetailListing — Task #120 L2 page for Sales Invoices.
// One row per sales_invoice_items line, with the SI header denormalised.
//
// 2026-06-16 — migrated off the shared DetailListingShell to the
// SalesOrderDetailListing structure: auto-running query (data shows on
// mount), a 4-tile KPI bar, the shared column-aware ColumnFilterBar
// ({filterBar}) replacing the old AutoCount Basic-Filter card + Inquiry
// button, and the DataGrid fed the filtered rows. The `?outstanding=1`
// overlay (balance > 0) is retained and applied to baseRows before the
// filter bar, exactly as the shell did.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ClipboardList, Printer } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useColumnFilter, type FilterColumn } from '../components/ColumnFilterBar';
import { useSalesInvoiceDetailListing, type DetailListingRow } from '../lib/flow-queries';
import styles from './SalesOrderDetailListing.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

/* Stable layout key for the DataGrid column order/hide state (unchanged from
   the pre-migration shell so the operator's column prefs carry over). */
const STORAGE_KEY = 'si-detail-listing-grid';

type SiRow = DetailListingRow & {
  invoice_number?: string;
  so_doc_no?: string | null;
  invoice_date?: string | null;
  due_date?: string | null;
  currency?: string;
  total_centi_header?: number;  // header.total_centi after flatten
  paid_centi?: number;
  uom?: string;
  item_group?: string | null;
  description2?: string | null;
  discount_centi?: number;
  tax_centi?: number;
  header_total_centi?: number;
  header_paid_centi?: number;
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const c = Number(centi ?? 0);
  return `${currency} ${(c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* Column-aware filter config for the SI Detail Listing. Built from the fields
   the /reports/sales-invoice-detail-listing endpoint actually flattens onto
   each line (sales_invoice_items + the sales_invoices header) — so every enum
   dropdown is backed by real data and every text/date column matches a present
   field. The header-only attributes the SI *list* filters on (branding, venue,
   location, customer type/state/country) aren't selected by this detail
   endpoint, so they're intentionally omitted here.
     text  → invoice no / SO doc no / customer / debtor code / item code
     enum  → item group / UOM / currency / status
     date  → invoice date / due date */
const SI_DETAIL_FILTER_COLUMNS: FilterColumn<SiRow>[] = [
  { key: 'doc_no',      label: 'Invoice No',  type: 'text', accessor: (r) => r.doc_no },
  { key: 'so_doc_no',   label: 'SO Doc No',   type: 'text', accessor: (r) => r.so_doc_no },
  { key: 'debtor',      label: 'Customer',    type: 'text', accessor: (r) => r.debtor_name },
  { key: 'debtor_code', label: 'Debtor Code', type: 'text', accessor: (r) => r.debtor_code },
  { key: 'item_code',   label: 'Item Code',   type: 'text', accessor: (r) => r.item_code },
  { key: 'item_group',  label: 'Item Group',  type: 'enum', accessor: (r) => r.item_group },
  { key: 'uom',         label: 'UOM',         type: 'enum', accessor: (r) => r.uom },
  { key: 'currency',    label: 'Currency',    type: 'enum', accessor: (r) => r.currency },
  { key: 'status',      label: 'Status',      type: 'enum', accessor: (r) => r.status },
  { key: 'invoice_date', label: 'Invoice Date', type: 'date', accessor: (r) => (r.invoice_date ?? r.line_date) as string | null },
  { key: 'due_date',    label: 'Due Date',    type: 'date', accessor: (r) => r.due_date ?? null },
];
const SI_DETAIL_QUICK_SEARCH_KEYS = ['doc_no', 'so_doc_no', 'debtor', 'debtor_code', 'item_code'];

const buildColumns = (): DataGridColumn<SiRow>[] => [
  {
    key: 'doc_no', label: 'Invoice No.', width: 130, sortable: true,
    accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
    searchValue: (r) => r.doc_no,
  },
  {
    key: 'invoice_date', label: 'Date', width: 100, sortable: true,
    accessor: (r) => fmtDateOrDash((r.invoice_date ?? r.line_date) as string | null),
    searchValue: (r) => String(r.invoice_date ?? r.line_date ?? ''),
    filterType: 'date', dateValue: (r) => (r.invoice_date ?? r.line_date) as string | null,
  },
  {
    key: 'due_date', label: 'Due', width: 100, sortable: true,
    accessor: (r) => fmtDateOrDash(r.due_date ?? null),
    searchValue: (r) => r.due_date ?? '',
    filterType: 'date', dateValue: (r) => r.due_date,
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
    key: 'unit_price', label: 'Unit Price', width: 110, align: 'right', sortable: true,
    accessor: (r) => fmtRm(r.unit_price_centi, r.currency),
    searchValue: (r) => fmtRm(r.unit_price_centi, r.currency),
    sortFn: (a, b) => Number(a.unit_price_centi ?? 0) - Number(b.unit_price_centi ?? 0),
  },
  {
    key: 'discount', label: 'Discount', width: 100, align: 'right', sortable: true,
    accessor: (r) => fmtRm(r.discount_centi, r.currency),
    searchValue: (r) => fmtRm(r.discount_centi, r.currency),
    sortFn: (a, b) => Number(a.discount_centi ?? 0) - Number(b.discount_centi ?? 0),
  },
  {
    key: 'line_total', label: 'Line Total', width: 110, align: 'right', sortable: true,
    accessor: (r) => fmtRm(r.total_centi, r.currency),
    searchValue: (r) => fmtRm(r.total_centi, r.currency),
    sortFn: (a, b) => Number(a.total_centi ?? 0) - Number(b.total_centi ?? 0),
  },
  {
    key: 'header_total', label: 'Invoice Total', width: 130, align: 'right', sortable: true,
    accessor: (r) => fmtRm(r.header_total_centi, r.currency),
    searchValue: (r) => fmtRm(r.header_total_centi, r.currency),
    sortFn: (a, b) => Number(a.header_total_centi ?? 0) - Number(b.header_total_centi ?? 0),
  },
  {
    key: 'header_paid', label: 'Paid', width: 110, align: 'right', sortable: true,
    accessor: (r) => fmtRm(r.header_paid_centi, r.currency),
    searchValue: (r) => fmtRm(r.header_paid_centi, r.currency),
    sortFn: (a, b) => Number(a.header_paid_centi ?? 0) - Number(b.header_paid_centi ?? 0),
  },
  {
    key: 'balance', label: 'Balance', width: 110, align: 'right', sortable: true,
    accessor: (r) => fmtRm(r.balance_centi, r.currency),
    searchValue: (r) => fmtRm(r.balance_centi, r.currency),
    sortFn: (a, b) => Number(a.balance_centi ?? 0) - Number(b.balance_centi ?? 0),
  },
  {
    key: 'status', label: 'Status', width: 120, sortable: true, groupable: true,
    accessor: (r) => (r.status ? String(r.status).replace(/_/g, ' ') : '—'),
    searchValue: (r) => r.status ?? '',
  },
];

/* Static columns at module scope so DataGrid's React.memo can hit — the
   columns hold no per-page state. */
const COLUMNS: DataGridColumn<SiRow>[] = buildColumns();

export const SalesInvoiceDetailListing = () => {
  const navigate = useNavigate();
  /* `?outstanding=1` overlay — keep only lines whose document has an open
     balance. The line-flat row repeats balance per line; the server computes
     balance_centi = header total − header paid per doc. Same param used on the
     L1 list and across all SI-family modules. */
  const [searchParams, setSearchParams] = useSearchParams();
  const outstandingOnly = searchParams.get('outstanding') === '1';
  const clearOutstanding = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('outstanding');
    setSearchParams(next, { replace: true });
  };

  /* ── Server-side query — auto-runs (data shows immediately, matching the SO
        Detail Listing). Date-range narrowing is now client-side via the column
        filter bar, so we fetch the full result set with no committed filters. */
  const committed = useMemo(() => ({}), []);
  const query = useSalesInvoiceDetailListing(committed);
  const rawRows = useMemo<SiRow[]>(() => (query.data?.rows ?? []) as SiRow[], [query.data]);

  /* Apply the outstanding-only overlay before handing rows to the shared
     ColumnFilterBar. */
  const baseRows = useMemo<SiRow[]>(() => {
    if (!outstandingOnly) return rawRows;
    return rawRows.filter((r) => Number(r.balance_centi ?? 0) > 0);
  }, [rawRows, outstandingOnly]);

  /* Column-aware filter (shared ColumnFilterBar): free-text quick search +
     add-a-column filters (enum / date presets + range / text). Replaces the
     old DetailListingShell Basic-Filter card + Inquiry button. The
     outstanding-only toggle still flows via ?outstanding=1 and applies on top
     of the column filters. */
  const { rows: filteredRows, bar: filterBar } = useColumnFilter<SiRow>({
    allRows: baseRows,
    columns: SI_DETAIL_FILTER_COLUMNS,
    quickSearchKeys: SI_DETAIL_QUICK_SEARCH_KEYS,
    quickSearchPlaceholder: 'Invoice No, SO, debtor, SKU…',
    storageKey: 'pr-g.si-detail-listing.filters.v1',
    totalCount: rawRows.length,
    loading: query.isFetching,
  });

  /* ── KPI tiles — computed off the filtered row set so narrowing the filters
        re-scopes the headline numbers. Revenue = sum of LINE totals;
        Outstanding = balance deduped per invoice (the line-flat row repeats it
        per line). Mirrors the shell's defaultComputeKpis + SI's hideKpis
        (cost/margin not shown) and "Unique Invoices" label. */
  const kpis = useMemo(() => {
    const totalLines = filteredRows.length;
    const uniqueDocs = new Set<string>();
    let revenue = 0;
    const outstandingByDoc = new Map<string, number>();
    for (const r of filteredRows) {
      uniqueDocs.add(r.doc_no);
      revenue += Number(r.total_centi ?? 0);
      if (!outstandingByDoc.has(r.doc_no)) {
        outstandingByDoc.set(r.doc_no, Number(r.balance_centi ?? 0));
      }
    }
    const outstanding = [...outstandingByDoc.values()].reduce((s, v) => s + v, 0);
    return { totalLines, uniqueInvoices: uniqueDocs.size, revenue, outstanding };
  }, [filteredRows]);

  const [findNonce, setFindNonce] = useState(0);
  const runPrint = () => window.print();

  useEffect(() => {
    document.title = `Sales Invoice Details · ${kpis.totalLines} items`;
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
              Sales Invoice Detail Listing
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

      {/* ── 4 KPI tiles (scoped to current filters) ─ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-2)',
      }}>
        {([
          { label: 'Total Lines',      value: kpis.totalLines.toString() },
          { label: 'Unique Invoices',  value: kpis.uniqueInvoices.toString() },
          { label: 'Revenue (RM)',     value: fmtRm(kpis.revenue) },
          { label: 'Outstanding (RM)', value: fmtRm(kpis.outstanding),
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
          add-a-column filters). Replaces the old AutoCount Basic-Filter card +
          Inquiry button. */}
      {filterBar}

      {/* ── DataGrid ─── */}
      <section className={styles.resultCard}>
        <DataGrid<SiRow>
          rows={filteredRows}
          columns={COLUMNS}
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

// Re-export the visible column-key list (for tests / debug).
export const COL_KEYS: string[] = COLUMNS.map((c) => c.key);
