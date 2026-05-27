// ----------------------------------------------------------------------------
// ConsignmentDetailListing — Task #120 L2 page for Consignment Orders.
// One row per consignment_order_items line, with the consignment header
// denormalised. Consignment differs from SO/DO/SI: per-line value comes
// from qty_placed × unit_price (server-side). "Outstanding" = stock still
// at the customer's branch (placed − sold − returned − damaged).
// ----------------------------------------------------------------------------

import { useCallback } from 'react';
import { DetailListingShell } from '../components/DetailListingShell';
import { useConsignmentDetailListing, type DetailListingRow } from '../lib/flow-queries';
import type { DataGridColumn } from '../components/DataGrid';
import styles from './SalesOrderDetailListing.module.css';

type ConsRow = DetailListingRow & {
  consignment_number?: string;
  placed_at?: string | null;
  branch_location?: string | null;
  qty_placed?: number;
  qty_sold?: number;
  qty_returned?: number;
  qty_damaged?: number;
  outstanding_qty?: number;
  uom?: string;
  item_group?: string | null;
};

const fmtRm = (centi: number | null | undefined): string => {
  const c = Number(centi ?? 0);
  return `MYR ${(c / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const ConsignmentDetailListing = () => {
  const buildColumns = useCallback((opts: { checked: Record<string, boolean>; onToggle: (id: string) => void }): DataGridColumn<ConsRow>[] => [
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
      key: 'doc_no', label: 'Consign No.', width: 130, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
      searchValue: (r) => r.doc_no,
    },
    {
      key: 'placed_at', label: 'Placed', width: 100, sortable: true,
      accessor: (r) => (r.placed_at ?? r.line_date ?? '—') as string,
      searchValue: (r) => String(r.placed_at ?? r.line_date ?? ''),
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
      key: 'branch_location', label: 'Branch', width: 180, sortable: true, groupable: true,
      accessor: (r) => r.branch_location ?? '—',
      searchValue: (r) => r.branch_location ?? '',
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
      key: 'qty_placed', label: 'Qty Placed', width: 90, align: 'right', sortable: true,
      accessor: (r) => String(r.qty_placed ?? 0),
      searchValue: (r) => String(r.qty_placed ?? 0),
      sortFn: (a, b) => Number(a.qty_placed ?? 0) - Number(b.qty_placed ?? 0),
    },
    {
      key: 'qty_sold', label: 'Sold', width: 80, align: 'right', sortable: true,
      accessor: (r) => String(r.qty_sold ?? 0),
      searchValue: (r) => String(r.qty_sold ?? 0),
      sortFn: (a, b) => Number(a.qty_sold ?? 0) - Number(b.qty_sold ?? 0),
    },
    {
      key: 'qty_returned', label: 'Returned', width: 90, align: 'right', sortable: true,
      accessor: (r) => String(r.qty_returned ?? 0),
      searchValue: (r) => String(r.qty_returned ?? 0),
      sortFn: (a, b) => Number(a.qty_returned ?? 0) - Number(b.qty_returned ?? 0),
    },
    {
      key: 'qty_damaged', label: 'Damaged', width: 90, align: 'right', sortable: true,
      accessor: (r) => String(r.qty_damaged ?? 0),
      searchValue: (r) => String(r.qty_damaged ?? 0),
      sortFn: (a, b) => Number(a.qty_damaged ?? 0) - Number(b.qty_damaged ?? 0),
    },
    {
      key: 'outstanding_qty', label: 'At Branch', width: 90, align: 'right', sortable: true,
      accessor: (r) => {
        const q = Number(r.outstanding_qty ?? 0);
        return <span style={{ fontWeight: q > 0 ? 600 : 400, color: q > 0 ? 'var(--c-burnt)' : 'var(--fg-muted)' }}>{q}</span>;
      },
      searchValue: (r) => String(r.outstanding_qty ?? 0),
      sortFn: (a, b) => Number(a.outstanding_qty ?? 0) - Number(b.outstanding_qty ?? 0),
    },
    {
      key: 'unit_price', label: 'Unit Price', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.unit_price_centi),
      searchValue: (r) => fmtRm(r.unit_price_centi),
      sortFn: (a, b) => Number(a.unit_price_centi ?? 0) - Number(b.unit_price_centi ?? 0),
    },
    {
      key: 'line_total', label: 'Total Placed Value', width: 140, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.total_centi),
      searchValue: (r) => fmtRm(r.total_centi),
      sortFn: (a, b) => Number(a.total_centi ?? 0) - Number(b.total_centi ?? 0),
    },
    {
      key: 'balance', label: 'At-Branch Value', width: 140, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.balance_centi),
      searchValue: (r) => fmtRm(r.balance_centi),
      sortFn: (a, b) => Number(a.balance_centi ?? 0) - Number(b.balance_centi ?? 0),
    },
    {
      key: 'status', label: 'Status', width: 120, sortable: true, groupable: true,
      accessor: (r) => (r.status ? String(r.status).replace(/_/g, ' ') : '—'),
      searchValue: (r) => r.status ?? '',
    },
  ], []);

  return (
    <DetailListingShell<ConsRow>
      title="Consignment Detail Listing"
      subtitle="AutoCount-style report · one row per Consignment line item"
      storageKey="cons-detail-listing-grid"
      docNoPlaceholder="CO-2605-001"
      useDetailQuery={useConsignmentDetailListing}
      buildColumns={buildColumns}
      kpiLabels={{
        revenue: 'Placed Value',
        uniqueDocs: 'Unique Consignments',
        outstanding: 'At-Branch Value',
      }}
      hideKpis={{ cost: true, margin: true }}
      computeKpis={(rows) => {
        const totalLines = rows.length;
        const uniqueDocs = new Set<string>();
        let revenue = 0;
        let outstanding = 0;
        for (const r of rows) {
          uniqueDocs.add(r.doc_no);
          revenue += Number(r.total_centi ?? 0);
          // For consignment, outstanding is per-LINE (qty at branch × unit
          // price), not per-doc, so we sum directly without dedupe.
          outstanding += Number(r.balance_centi ?? 0);
        }
        return {
          totalLines, uniqueDocs: uniqueDocs.size,
          revenue, cost: 0, margin: 0, marginPct: 0, outstanding,
        };
      }}
    />
  );
};
