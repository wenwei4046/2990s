// PR-G — Sales Order list page rebuild (AutoCount data-grid style).
//
// 23-column ledger view backed by <DataGrid>. Replaces the old plain-table
// MfgSalesOrdersPage in FlowPages.tsx. The page owns its toolbar buttons
// (New / Edit / View / Find / Preview / Print / Print Listing / Delete /
// Refresh) and the DataGrid owns the search + column UX.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Eye, Search, FileText, Printer, ListChecks, Trash2, RefreshCw,
} from 'lucide-react';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useMfgSalesOrders, useUpdateMfgSalesOrderStatus } from '../lib/flow-queries';
import { generateSalesOrderPdf } from '../lib/sales-order-pdf';
import { supabase } from '../lib/supabase';
import styles from './MfgSalesOrdersList.module.css';
import soDetailStyles from './SalesOrderDetail.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

type SoRow = {
  doc_no: string;
  transfer_to: string | null;
  so_date: string;
  branding: string | null;
  debtor_name: string;
  agent: string | null;
  sales_location: string | null;
  ref: string | null;
  customer_so_no: string | null;
  local_total_centi: number;
  balance_centi: number;
  /* Follow-up #83 — live balance derived from payments ledger. Comes from
     the mfg_sales_orders_with_payment_totals view. May be null/absent on
     older clients / failed view migration; column falls back to
     balance_centi → (local_total − paid_centi). */
  balance_centi_live?: number | null;
  paid_total_centi?: number | null;
  paid_centi: number;
  remark2: string | null;
  remark3: string | null;
  remark4: string | null;
  processing_date: string | null;
  sales_exemption_expiry: string | null;
  customer_delivery_date: string | null;
  note: string | null;
  po_doc_no: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
  phone: string | null;
  venue: string | null;
  status: string;
  currency: string;
};

const fmtRm = (centi: number): string =>
  (centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Follow-up #83 — Balance column source-of-truth chain:
   1. view's balance_centi_live (local_total − sum(payments))
   2. header.balance_centi (legacy stored value)
   3. local_total − header.paid_centi (last-resort derivation) */
const liveBalance = (r: SoRow): number => {
  if (typeof r.balance_centi_live === 'number') return r.balance_centi_live;
  if (typeof r.balance_centi === 'number') return r.balance_centi;
  return r.local_total_centi - (r.paid_centi ?? 0);
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT:          soDetailStyles.statusDraft ?? '',
  CONFIRMED:      soDetailStyles.statusConfirmed ?? '',
  IN_PRODUCTION:  soDetailStyles.statusInProd ?? '',
  READY_TO_SHIP:  soDetailStyles.statusReady ?? '',
  SHIPPED:        soDetailStyles.statusShipped ?? '',
  DELIVERED:      soDetailStyles.statusDelivered ?? '',
  INVOICED:       soDetailStyles.statusInvoiced ?? '',
  CLOSED:         soDetailStyles.statusClosed ?? '',
  CANCELLED:      soDetailStyles.statusCancelled ?? '',
};

const StatusPill = ({ status }: { status: string }) => (
  <span className={`${soDetailStyles.statusPill} ${STATUS_CLASS[status] ?? ''}`}>
    {status.replace(/_/g, ' ')}
  </span>
);

export const MfgSalesOrdersList = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useMfgSalesOrders(undefined);
  const rows = useMemo<SoRow[]>(() => (data?.salesOrders ?? []) as SoRow[], [data]);

  const [selected, setSelected] = useState<SoRow[]>([]);
  const [findNonce, setFindNonce] = useState(0);
  const selectedRow = selected[0] ?? null;

  const updateStatus = useUpdateMfgSalesOrderStatus();

  // ── Toolbar handlers ────────────────────────────────────────────
  const onNew = () => navigate('/mfg-sales-orders/new');
  const openDetail = (row: SoRow, edit = false) =>
    navigate(`/mfg-sales-orders/${row.doc_no}${edit ? '?edit=1' : ''}`);
  const onEdit = () => selectedRow && openDetail(selectedRow, true);
  const onView = () => selectedRow && openDetail(selectedRow);
  const onFind = () => setFindNonce((n) => n + 1);

  const renderPdf = async (row: SoRow, andPrint: boolean) => {
    // One-shot fetch when the toolbar button fires — avoids holding a
    // TanStack query open for every list selection.
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(
      `${import.meta.env.VITE_API_URL}/mfg-sales-orders/${row.doc_no}`,
      { headers: { authorization: `Bearer ${session.session?.access_token ?? ''}` } },
    );
    if (!res.ok) { alert(`Failed to load SO ${row.doc_no}`); return; }
    const json = (await res.json()) as { salesOrder: unknown; items: unknown[] };
    /* PR-G: jspdf triggers download via doc.save(). Print mode reuses the
       same generator and follows it with window.print(); the user's
       browser then displays the OS print dialog over the downloaded PDF. */
    await generateSalesOrderPdf(json.salesOrder as never, json.items as never);
    if (andPrint) window.print();
  };

  const onPreview = () => selectedRow && void renderPdf(selectedRow, false);
  const onPrint = () => selectedRow && void renderPdf(selectedRow, true);

  // Print listing — generate a PDF of the current visible grid (filtered
  // rows + visible columns) using jsPDF + autotable.
  const onPrintListing = async () => {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('Sales Orders — Listing', 14, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${rows.length} rows · ${new Date().toISOString().slice(0, 10)}`, 14, 20);

    // Read layout from localStorage to honour the user's visible columns.
    let visibleKeys: string[] = COLUMNS.map((c) => c.key);
    let hidden: string[] = [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const layout = JSON.parse(raw) as { order?: string[]; hidden?: string[] };
        const order = layout.order && layout.order.length
          ? [...layout.order, ...COLUMNS.map((c) => c.key).filter((k) => !layout.order!.includes(k))]
          : COLUMNS.map((c) => c.key);
        hidden = layout.hidden ?? [];
        visibleKeys = order.filter((k) => !hidden.includes(k));
      }
    } catch { /* fall back to all columns */ }

    const visibleCols = visibleKeys
      .map((k) => COLUMNS.find((c) => c.key === k))
      .filter((c): c is DataGridColumn<SoRow> => Boolean(c));

    const head = [visibleCols.map((c) => c.label)];
    const body = rows.map((r) =>
      visibleCols.map((c) => {
        // Use search-friendly string form for the PDF (skip pill JSX).
        if (c.searchValue) return c.searchValue(r);
        const v = c.accessor(r);
        return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
      }),
    );
    autoTable(doc, {
      head, body, startY: 26,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [240, 235, 225], textColor: [34, 31, 32], fontStyle: 'bold' },
      theme: 'grid',
    });
    doc.save(`sales-orders-listing-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const onDelete = () => {
    if (!selectedRow) return;
    if (!window.confirm(`Cancel SO ${selectedRow.doc_no}? This sets status = CANCELLED (soft delete).`)) return;
    updateStatus.mutate(
      { docNo: selectedRow.doc_no, status: 'CANCELLED' },
      {
        onSuccess: () => { setSelected([]); },
        onError: (e) => alert(`Failed: ${e instanceof Error ? e.message : String(e)}`),
      },
    );
  };

  const onRefresh = () => {
    qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
    void refetch();
  };

  // ── Columns (23 reference + 1 status pill) ──────────────────────
  // Order matches the AutoCount reference layout the commander provided.
  // Customer Name = debtor_name (Commander PR #46 rename in flight).
  // Customer SO Ref + Delivery Date inserted into the AutoCount layout.

  const tb = (
    <>
      <button className={styles.tbarBtn} onClick={onNew} title="Create a new SO"><Plus {...ICON} /> New</button>
      <button className={styles.tbarBtn} onClick={onEdit} disabled={!selectedRow}><Pencil {...ICON} /> Edit</button>
      <button className={styles.tbarBtn} onClick={onView} disabled={!selectedRow}><Eye {...ICON} /> View</button>
      <button className={styles.tbarBtn} onClick={onFind}><Search {...ICON} /> Find</button>
      <button className={styles.tbarBtn} onClick={onPreview} disabled={!selectedRow}><FileText {...ICON} /> Preview</button>
      <button className={styles.tbarBtn} onClick={onPrint} disabled={!selectedRow}><Printer {...ICON} /> Print</button>
      <button className={styles.tbarBtn} onClick={onPrintListing}><ListChecks {...ICON} /> Print Listing</button>
      <button
        className={`${styles.tbarBtn} ${styles.tbarBtnDanger}`}
        onClick={onDelete}
        disabled={!selectedRow || updateStatus.isPending}
      >
        <Trash2 {...ICON} /> Delete
      </button>
      <button className={styles.tbarBtn} onClick={onRefresh} title="Refetch from server">
        <RefreshCw {...ICON} /> Refresh
      </button>
    </>
  );

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Sales Orders</h1>
          <p className={styles.subtitle}>
            Manufacturer sales orders — AutoCount-style ledger view.
            {' '}{isLoading ? 'Loading…' : `${rows.length} total`}
          </p>
        </div>
      </div>
      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid<SoRow>
        rows={rows}
        columns={COLUMNS}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.doc_no}
        toolbar={tb}
        searchPlaceholder="Search SOs…"
        focusSearchNonce={findNonce}
        onRowDoubleClick={(r) => openDetail(r)}
        onSelectionChange={setSelected}
        isLoading={isLoading}
        emptyMessage='No sales orders yet — click "New" to start.'
      />
    </div>
  );
};

const STORAGE_KEY = 'pr-g.so-list.layout.v1';

const COLUMNS: DataGridColumn<SoRow>[] = [
  {
    key: 'doc_no', label: 'Doc. No.', width: 110, sortable: true, groupable: false,
    accessor: (r) => <span className={styles.docNo}>{r.doc_no}</span>,
    searchValue: (r) => r.doc_no,
  },
  {
    key: 'transfer_to', label: 'Transfer To', width: 110, sortable: true, groupable: true,
    accessor: (r) => r.transfer_to ?? '',
    searchValue: (r) => r.transfer_to ?? '',
  },
  {
    key: 'so_date', label: 'Date', width: 100, sortable: true,
    accessor: (r) => r.so_date,
    searchValue: (r) => r.so_date,
  },
  {
    key: 'branding', label: 'Branding', width: 120, sortable: true, groupable: true,
    accessor: (r) => r.branding ?? '',
    searchValue: (r) => r.branding ?? '',
  },
  {
    key: 'debtor_name', label: 'Customer Name', width: 220, sortable: true, groupable: true,
    accessor: (r) => r.debtor_name,
    searchValue: (r) => r.debtor_name,
  },
  {
    key: 'agent', label: 'Agent', width: 120, sortable: true, groupable: true,
    accessor: (r) => r.agent ?? '',
    searchValue: (r) => r.agent ?? '',
  },
  {
    key: 'sales_location', label: 'Sales Location', width: 140, sortable: true, groupable: true,
    accessor: (r) => r.sales_location ?? '',
    searchValue: (r) => r.sales_location ?? '',
  },
  {
    key: 'ref', label: 'Ref.', width: 100, sortable: true,
    accessor: (r) => r.ref ?? '',
    searchValue: (r) => r.ref ?? '',
  },
  {
    key: 'customer_so_no', label: 'Customer SO Ref', width: 140, sortable: true,
    accessor: (r) => r.customer_so_no ?? '',
    searchValue: (r) => r.customer_so_no ?? '',
  },
  {
    key: 'local_total_centi', label: 'Local Total', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.local_total_centi)}</span>,
    searchValue: (r) => fmtRm(r.local_total_centi),
    sortFn: (a, b) => a.local_total_centi - b.local_total_centi,
  },
  {
    /* Follow-up #83 — prefer the view's live balance (local_total −
       sum(payments)). Falls back to the stored header balance_centi if the
       view column is missing (older API), then to a client-side derivation
       from paid_centi as the last resort. */
    key: 'balance_centi', label: 'Balance', width: 110, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(liveBalance(r))}</span>,
    searchValue: (r) => fmtRm(liveBalance(r)),
    sortFn: (a, b) => liveBalance(a) - liveBalance(b),
  },
  {
    key: 'remark2', label: 'Remark 2', width: 140, sortable: true,
    accessor: (r) => r.remark2 ?? '',
    searchValue: (r) => r.remark2 ?? '',
  },
  {
    key: 'remark3', label: 'Remark 3', width: 140, sortable: true,
    accessor: (r) => r.remark3 ?? '',
    searchValue: (r) => r.remark3 ?? '',
  },
  {
    key: 'remark4', label: 'Remark 4', width: 140, sortable: true,
    accessor: (r) => r.remark4 ?? '',
    searchValue: (r) => r.remark4 ?? '',
  },
  {
    key: 'processing_date', label: 'Processing Date', width: 130, sortable: true,
    accessor: (r) => r.processing_date ?? '',
    searchValue: (r) => r.processing_date ?? '',
  },
  {
    key: 'customer_delivery_date', label: 'Delivery Date', width: 130, sortable: true,
    accessor: (r) => r.customer_delivery_date ?? '',
    searchValue: (r) => r.customer_delivery_date ?? '',
  },
  {
    key: 'sales_exemption_expiry', label: 'Sales Exemption Expiry', width: 170, sortable: true,
    accessor: (r) => r.sales_exemption_expiry ?? '',
    searchValue: (r) => r.sales_exemption_expiry ?? '',
  },
  {
    key: 'note', label: 'Note', width: 200, sortable: true,
    accessor: (r) => r.note ?? '',
    searchValue: (r) => r.note ?? '',
  },
  {
    key: 'po_doc_no', label: 'PO Doc No.', width: 130, sortable: true,
    accessor: (r) => r.po_doc_no ?? '',
    searchValue: (r) => r.po_doc_no ?? '',
  },
  {
    key: 'address1', label: 'Address 1', width: 180, sortable: true,
    accessor: (r) => r.address1 ?? '',
    searchValue: (r) => r.address1 ?? '',
  },
  {
    key: 'address2', label: 'Address 2', width: 180, sortable: true,
    accessor: (r) => r.address2 ?? '',
    searchValue: (r) => r.address2 ?? '',
  },
  {
    key: 'address3', label: 'Address 3', width: 180, sortable: true,
    accessor: (r) => r.address3 ?? '',
    searchValue: (r) => r.address3 ?? '',
  },
  {
    key: 'address4', label: 'Address 4', width: 180, sortable: true,
    accessor: (r) => r.address4 ?? '',
    searchValue: (r) => r.address4 ?? '',
  },
  {
    key: 'phone', label: 'Phone', width: 130, sortable: true,
    accessor: (r) => r.phone ?? '',
    searchValue: (r) => r.phone ?? '',
  },
  {
    key: 'venue', label: 'Venue', width: 130, sortable: true, groupable: true,
    accessor: (r) => r.venue ?? '',
    searchValue: (r) => r.venue ?? '',
  },
  {
    key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
    accessor: (r) => <StatusPill status={r.status} />,
    searchValue: (r) => r.status,
    groupValue: (r) => r.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
];
