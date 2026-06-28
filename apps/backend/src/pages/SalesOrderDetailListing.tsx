// ----------------------------------------------------------------------------
// SalesOrderDetailListing — Task #120 L2 page for Sales Orders.
// One row per mfg_sales_order_items line, with the SO header denormalised.
// This is the canonical L2 the sibling DO / SI / DR listings were modelled on
// (DetailListingShell + a per-module query hook); it was referenced from the
// SO + Consignment list toolbars and auth-guarded, but the page itself was
// never built. Mirrors SalesInvoiceDetailListing — the closest order-to-cash
// sibling — and unlike SI/DO/DR the SO carries full cost + margin, so those
// KPI tiles stay visible here.
//
// The /reports/sales-order-detail-listing endpoint already exists (it was the
// first reporting endpoint built — apps/api/src/routes/reports.ts). The shared
// useSalesOrderDetailListing hook was never added to flow-queries.ts, so the
// query is wired inline here against that endpoint, matching the exact shape of
// useSalesInvoiceDetailListing (same DetailListingFilters → querystring → the
// { rows } response the shell consumes).
// ----------------------------------------------------------------------------

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fmtCenti, fmtDateOrDash } from '@2990s/shared';
import { DetailListingShell, type DetailListingKpis } from '../components/DetailListingShell';
import { authedFetch } from '../lib/authed-fetch';
import type { DetailListingFilters, DetailListingRow } from '../lib/flow-queries';
import type { DataGridColumn } from '../components/DataGrid';
import { ItemGroupPill, BrandingPill } from '../lib/category-badges';
import styles from './SalesOrderDetailListing.module.css';

// SO-specific fields the server flattens onto each line row, on top of the
// common DetailListingRow shape. Header fields (so_date, branding, status,
// header totals) are merged down onto the line by the endpoint's flatten pass.
type SoRow = DetailListingRow & {
  so_date?: string | null;
  customer_delivery_date?: string | null;
  agent?: string | null;
  branding?: string | null;
  currency?: string;
  uom?: string | null;
  item_group?: string | null;
  description2?: string | null;
  discount_centi?: number;
  tax_centi?: number;
  // Cost / margin — SO is the one order-to-cash doc that carries these.
  unit_cost_centi?: number;
  line_cost_centi?: number;
  line_margin_centi?: number;
  // Header rollups (denormalised onto each line by the endpoint).
  local_total_centi?: number;     // SO header grand total
  paid_total_centi?: number;      // derived from the payments ledger
  // Sofa line attributes surfaced by the endpoint's variants extraction.
  fabric?: string | null;
  divan_height?: number | string | null;
  leg_height?: number | string | null;
};

// Inline detail-listing query — replicates useSalesInvoiceDetailListing
// (flow-queries.ts) for the SO endpoint. Lives here because the shared hook was
// never added; the shape (filters → qs → { rows }) is identical so the shell's
// useDetailQuery contract is satisfied unchanged.
const buildDetailListingQs = (filters: DetailListingFilters): string => {
  const params = new URLSearchParams();
  if (filters.dateFrom)   params.set('dateFrom',   filters.dateFrom);
  if (filters.dateTo)     params.set('dateTo',     filters.dateTo);
  if (filters.docNo)      params.set('docNo',      filters.docNo);
  if (filters.debtorCode) params.set('debtorCode', filters.debtorCode);
  if (filters.itemCode)   params.set('itemCode',   filters.itemCode);
  return params.toString();
};

const useSalesOrderDetailListing = (filters: DetailListingFilters) => {
  const qs = buildDetailListingQs(filters);
  return useQuery({
    queryKey: ['reports', 'sales-order-detail-listing', qs],
    queryFn: () => authedFetch<{ rows: SoRow[] }>(
      `/reports/sales-order-detail-listing${qs ? `?${qs}` : ''}`,
    ),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
};

// Render a divan/leg height that may arrive as a parsed number (→ "4″") or a
// raw string ("No Leg") — mirrors the endpoint's heightVal normalisation.
const fmtHeight = (v: number | string | null | undefined): string => {
  if (v == null || v === '') return '—';
  return typeof v === 'number' ? `${v}″` : String(v);
};

export const SalesOrderDetailListing = () => {
  const buildColumns = useCallback((opts: { checked: Record<string, boolean>; onToggle: (id: string) => void }): DataGridColumn<SoRow>[] => [
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
      key: 'doc_no', label: 'SO No.', width: 120, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
      searchValue: (r) => r.doc_no,
      filterType: 'numbering', filterValue: (r) => r.doc_no,
    },
    {
      key: 'so_date', label: 'Date', width: 100, sortable: true,
      accessor: (r) => fmtDateOrDash((r.so_date ?? r.line_date) as string | null),
      searchValue: (r) => String(r.so_date ?? r.line_date ?? ''),
      filterType: 'date', dateValue: (r) => (r.so_date ?? r.line_date) as string | null,
    },
    {
      key: 'customer_delivery_date', label: 'Delivery Date', width: 110, sortable: true,
      accessor: (r) => fmtDateOrDash(r.customer_delivery_date ?? null),
      searchValue: (r) => String(r.customer_delivery_date ?? ''),
      filterType: 'date', dateValue: (r) => r.customer_delivery_date ?? null,
    },
    {
      key: 'debtor_code', label: 'Debtor Code', width: 110, sortable: true, groupable: true,
      accessor: (r) => r.debtor_code ?? '—',
      searchValue: (r) => r.debtor_code ?? '',
    },
    {
      key: 'debtor_name', label: 'Customer', width: 200, sortable: true, groupable: true,
      accessor: (r) => r.debtor_name ?? '—',
      searchValue: (r) => r.debtor_name ?? '',
    },
    {
      key: 'agent', label: 'Agent', width: 130, sortable: true, groupable: true,
      accessor: (r) => r.agent ?? '—',
      searchValue: (r) => r.agent ?? '',
    },
    {
      key: 'branding', label: 'Branding', width: 110, sortable: true, groupable: true,
      accessor: (r) => (r.branding ? <BrandingPill branding={r.branding} /> : '—'),
      searchValue: (r) => r.branding ?? '',
      filterType: 'enum', filterValue: (r) => r.branding ?? '',
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
      accessor: (r) => (r.item_group ? <ItemGroupPill group={r.item_group} /> : '—'),
      searchValue: (r) => r.item_group ?? '',
      filterType: 'enum', filterValue: (r) => r.item_group ?? '',
    },
    {
      key: 'fabric', label: 'Fabric', width: 130, sortable: true,
      accessor: (r) => r.fabric ?? '—',
      searchValue: (r) => r.fabric ?? '',
    },
    {
      key: 'divan_height', label: 'Divan Ht', width: 90, align: 'right', sortable: true,
      accessor: (r) => fmtHeight(r.divan_height),
      searchValue: (r) => String(r.divan_height ?? ''),
      sortFn: (a, b) => Number(a.divan_height ?? 0) - Number(b.divan_height ?? 0),
    },
    {
      key: 'leg_height', label: 'Leg Ht', width: 90, align: 'right', sortable: true,
      accessor: (r) => fmtHeight(r.leg_height),
      searchValue: (r) => String(r.leg_height ?? ''),
      sortFn: (a, b) => Number(a.leg_height ?? 0) - Number(b.leg_height ?? 0),
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
      filterType: 'number', numberValue: (r) => Number(r.qty ?? 0),
      sortFn: (a, b) => Number(a.qty ?? 0) - Number(b.qty ?? 0),
    },
    {
      key: 'unit_price', label: 'Unit Price', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.unit_price_centi),
      searchValue: (r) => fmtCenti(r.unit_price_centi),
      filterType: 'number', numberValue: (r) => Number(r.unit_price_centi ?? 0),
      sortFn: (a, b) => Number(a.unit_price_centi ?? 0) - Number(b.unit_price_centi ?? 0),
    },
    {
      key: 'discount', label: 'Discount', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.discount_centi),
      searchValue: (r) => fmtCenti(r.discount_centi),
      sortFn: (a, b) => Number(a.discount_centi ?? 0) - Number(b.discount_centi ?? 0),
    },
    {
      key: 'line_total', label: 'Line Total', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.total_centi),
      searchValue: (r) => fmtCenti(r.total_centi),
      filterType: 'number', numberValue: (r) => Number(r.total_centi ?? 0),
      sortFn: (a, b) => Number(a.total_centi ?? 0) - Number(b.total_centi ?? 0),
    },
    {
      key: 'line_cost', label: 'Cost', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.line_cost_centi),
      searchValue: (r) => fmtCenti(r.line_cost_centi),
      sortFn: (a, b) => Number(a.line_cost_centi ?? 0) - Number(b.line_cost_centi ?? 0),
    },
    {
      key: 'line_margin', label: 'Margin', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.line_margin_centi),
      searchValue: (r) => fmtCenti(r.line_margin_centi),
      sortFn: (a, b) => Number(a.line_margin_centi ?? 0) - Number(b.line_margin_centi ?? 0),
    },
    {
      key: 'order_total', label: 'Order Total', width: 130, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.local_total_centi),
      searchValue: (r) => fmtCenti(r.local_total_centi),
      sortFn: (a, b) => Number(a.local_total_centi ?? 0) - Number(b.local_total_centi ?? 0),
    },
    {
      key: 'paid', label: 'Paid', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.paid_total_centi),
      searchValue: (r) => fmtCenti(r.paid_total_centi),
      sortFn: (a, b) => Number(a.paid_total_centi ?? 0) - Number(b.paid_total_centi ?? 0),
    },
    {
      key: 'balance', label: 'Balance', width: 120, align: 'right', sortable: true,
      accessor: (r) => fmtCenti(r.balance_centi),
      searchValue: (r) => fmtCenti(r.balance_centi),
      sortFn: (a, b) => Number(a.balance_centi ?? 0) - Number(b.balance_centi ?? 0),
    },
    {
      key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
      accessor: (r) => (r.status ? String(r.status).replace(/_/g, ' ') : '—'),
      searchValue: (r) => r.status ?? '',
      filterType: 'enum', filterValue: (r) => (r.status ? String(r.status).replace(/_/g, ' ') : ''),
    },
  ], []);

  // SO carries real cost + margin, so compute the full KPI set (the shell's
  // default zeroes cost/margin). Revenue = Σ line totals (one row per line).
  // Order Total / Paid / Balance are header rollups denormalised onto every
  // line, so they're summed once per doc_no to avoid multiplying by line count.
  const computeKpis = useCallback((rows: SoRow[]): DetailListingKpis => {
    const totalLines = rows.length;
    const uniqueDocs = new Set<string>();
    let revenue = 0;
    let cost = 0;
    let margin = 0;
    const balanceByDoc = new Map<string, number>();
    for (const r of rows) {
      uniqueDocs.add(r.doc_no);
      revenue += Number(r.total_centi ?? 0);
      cost   += Number(r.line_cost_centi ?? 0);
      margin += Number(r.line_margin_centi ?? 0);
      if (!balanceByDoc.has(r.doc_no)) {
        balanceByDoc.set(r.doc_no, Number(r.balance_centi ?? 0));
      }
    }
    const outstanding = [...balanceByDoc.values()].reduce((s, v) => s + v, 0);
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return {
      totalLines, uniqueDocs: uniqueDocs.size,
      revenue, cost, margin, marginPct, outstanding,
    };
  }, []);

  return (
    <DetailListingShell<SoRow>
      title="Sales Order Detail Listing"
      storageKey="so-detail-listing-grid"
      docNoPlaceholder="SO-2606-001"
      useDetailQuery={useSalesOrderDetailListing}
      buildColumns={buildColumns}
      computeKpis={computeKpis}
      kpiLabels={{ uniqueDocs: 'Unique SOs' }}
    />
  );
};
