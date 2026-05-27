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
  Plus, Pencil, Eye, Search, FileText, Printer, ListChecks, Trash2, RefreshCw, Wrench,
} from 'lucide-react';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { formatPhone } from '@2990s/shared/phone';
import { useMfgSalesOrders, useUpdateMfgSalesOrderStatus, useConvertSoToDo } from '../lib/flow-queries';
import { useStaff } from '../lib/admin-queries';
import { generateSalesOrderPdf } from '../lib/sales-order-pdf';
import { supabase } from '../lib/supabase';
import styles from './MfgSalesOrdersList.module.css';
import soDetailStyles from './SalesOrderDetail.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

/* Commander 2026-05-27: "SO 的那些 column 是根据我们的 column 去添加的
   没有的你不要跟 autocount". Align columns to ACTUAL 2990 schema (no
   HOOKKA-legacy columns like `agent` / `sales_location` / `ref` that
   2990 doesn't populate). Address line 3/4 dropped — `city` + `postcode`
   are now proper columns (PR #46 POS handover). Salesperson, customer
   code, email, customer type, building type, state added — all are
   populated for trading SOs. */
type SoRow = {
  doc_no: string;
  so_date: string;
  branding: string | null;
  debtor_code: string | null;
  debtor_name: string;
  salesperson_id: string | null;
  customer_so_no: string | null;
  phone: string | null;
  email: string | null;
  customer_type: string | null;
  building_type: string | null;
  venue: string | null;
  address1: string | null;
  address2: string | null;
  customer_state: string | null;
  city: string | null;
  postcode: string | null;
  processing_date: string | null;
  customer_delivery_date: string | null;
  note: string | null;
  local_total_centi: number;
  /* Live balance + paid total come from mfg_sales_orders_with_payment_totals
     view (migration 0076). Fall back to legacy balance_centi → (local_total
     − paid_centi) when the view isn't surfaced. */
  balance_centi: number;
  balance_centi_live?: number | null;
  paid_total_centi?: number | null;
  paid_centi: number;
  deposit_centi: number | null;
  status: string;
  currency: string;
  /* Task #114 — Per-category REVENUE + COST + overall cost/margin from the
     SO header. All four cost columns added in migration 0079; pre-existing
     rows backfill on next item mutation (recomputeTotals). Optional on the
     row type so the list still renders if the API hasn't been redeployed. */
  mattress_sofa_centi?: number;
  bedframe_centi?: number;
  accessories_centi?: number;
  others_centi?: number;
  mattress_sofa_cost_centi?: number;
  bedframe_cost_centi?: number;
  accessories_cost_centi?: number;
  others_cost_centi?: number;
  total_cost_centi?: number;
  total_margin_centi?: number;
  margin_pct_basis?: number;
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
  // DRAFT removed in migration 0078 — SOs start at CONFIRMED.
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

  /* Salesperson column → look up staff name from salesperson_id. Stable
     map memoized off the staff list so DataGrid's column memo only
     invalidates when staff actually changes. */
  const staffQ = useStaff();
  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (staffQ.data ?? [])) {
      if (s.id) m.set(s.id, s.name ?? s.staffCode ?? s.id);
    }
    return m;
  }, [staffQ.data]);
  const COLUMNS = useMemo(() => buildColumns(staffById), [staffById]);

  const [selected, setSelected] = useState<SoRow[]>([]);
  const [findNonce, setFindNonce] = useState(0);
  const selectedRow = selected[0] ?? null;

  const updateStatus = useUpdateMfgSalesOrderStatus();
  const convertToDoMut = useConvertSoToDo();

  // ── Toolbar handlers ────────────────────────────────────────────
  const onNew = () => navigate('/mfg-sales-orders/new');
  const openDetail = (row: SoRow, edit = false) =>
    navigate(`/mfg-sales-orders/${row.doc_no}${edit ? '?edit=1' : ''}`);
  const onEdit = () => selectedRow && openDetail(selectedRow, true);
  const onView = () => selectedRow && openDetail(selectedRow);
  const onFind = () => setFindNonce((n) => n + 1);

  const renderPdf = async (row: SoRow, action: 'save' | 'print' | 'preview') => {
    // One-shot fetch when the toolbar button fires — avoids holding a
    // TanStack query open for every list selection.
    // Followup #81: parallel-fetch payments from the ledger alongside the
    // SO detail. Both endpoints are auth'd off the same Supabase session.
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token ?? '';
    const headers = { authorization: `Bearer ${token}` };
    /* Follow-up #81 — parallel-fetch detail + payments (ledger). */
    const [detailRes, paymentsRes] = await Promise.all([
      fetch(`${import.meta.env.VITE_API_URL}/mfg-sales-orders/${row.doc_no}`, { headers }),
      fetch(`${import.meta.env.VITE_API_URL}/mfg-sales-orders/${row.doc_no}/payments`, { headers }),
    ]);
    if (!detailRes.ok) { alert(`Failed to load SO ${row.doc_no}`); return; }
    const json = (await detailRes.json()) as { salesOrder: unknown; items: unknown[] };
    /* Payments endpoint is best-effort: if it fails the PDF still renders
       with an empty Payments table rather than blocking Preview/Print. */
    let payments: unknown[] = [];
    if (paymentsRes.ok) {
      try {
        const pj = (await paymentsRes.json()) as { payments?: unknown[] };
        payments = pj.payments ?? [];
      } catch { /* leave empty — PDF will show the no-payments state */ }
    }
    /* Follow-up #83 — action routes the PDF to doc.save() / hidden iframe
       print / blob preview, instead of always downloading and asking the
       user to find the file. Payments arg from #81 is threaded through. */
    await generateSalesOrderPdf(json.salesOrder as never, json.items as never, payments as never, action);
  };

  const onPreview = () => selectedRow && void renderPdf(selectedRow, 'preview');
  const onPrint = () => selectedRow && void renderPdf(selectedRow, 'print');

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
    /* Follow-up #83 — Print Listing now renders via hidden iframe +
       window.print() instead of doc.save(). Same UX as the single-SO
       Print button — user gets the OS print dialog directly, no need
       to fish a downloaded PDF out of the Downloads folder. */
    const blob = doc.output('blob');
    const blobUrl = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = blobUrl;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch { /* PDF viewer may not have hydrated; cleanup still runs */ }
    };
    window.setTimeout(() => {
      try { document.body.removeChild(iframe); } catch { /* already detached */ }
      URL.revokeObjectURL(blobUrl);
    }, 60_000);
  };

  /* Soft-delete a SO row (sets status=CANCELLED). Shared by the toolbar's
     Delete button and the row context menu's Delete entry. */
  const doDelete = (row: SoRow) => {
    if (!window.confirm(`Cancel SO ${row.doc_no}? This sets status = CANCELLED (soft delete).`)) return;
    updateStatus.mutate(
      { docNo: row.doc_no, status: 'CANCELLED' },
      {
        onSuccess: () => { setSelected([]); },
        onError: (e) => alert(`Failed: ${e instanceof Error ? e.message : String(e)}`),
      },
    );
  };
  const onDelete = () => { if (selectedRow) doDelete(selectedRow); };

  /* Convert an SO → new DO via the API, then navigate to the new DO so
     commander can immediately review/dispatch. Confirmation prompt
     matches the soft-delete tone — destructive enough to warrant a
     "are you sure?" but not so dangerous it needs typed confirmation. */
  const convertToDo = async (row: SoRow) => {
    if (!window.confirm(`Convert SO ${row.doc_no} to a new Delivery Order?`)) return;
    try {
      const res = await convertToDoMut.mutateAsync({ docNo: row.doc_no });
      navigate(`/mfg-delivery-orders/${res.deliveryOrderId}`);
    } catch (e) {
      alert(`Failed to convert: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /* TODO(copy-to-new-so): out of scope for this PR. Will need a
     sessionStorage handoff carrying the SO header + line items so the
     New SO page can pre-fill. Wire up in a follow-up worktree. */
  const copyToNewSo = (row: SoRow) => {
    alert(`Copy to new SO is not implemented yet (would clone SO ${row.doc_no}).`);
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
      {/* Task #110 — Localities moved out of Settings into a dedicated SO
          Maintenance page. Toolbar button is the primary entry; sidebar
          also gets a direct link. */}
      <button
        className={styles.tbarBtn}
        onClick={() => navigate('/mfg-sales-orders/maintenance')}
        title="State → warehouse mapping + cascading address dropdowns"
      >
        <Wrench {...ICON} /> Maintenance
      </button>
    </>
  );

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Sales Orders</h1>
          <p className={styles.subtitle}>
            Sales orders — AutoCount-style ledger view.
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
        contextMenu={(row) => [
          { label: 'Edit',                       onClick: () => openDetail(row, true) },
          { label: 'View',                       onClick: () => openDetail(row) },
          { label: 'Preview',                    onClick: () => void renderPdf(row, 'preview') },
          { label: 'Print',                      onClick: () => void renderPdf(row, 'print') },
          { divider: true },
          { label: 'Convert to Delivery Order',  onClick: () => void convertToDo(row) },
          { label: 'Copy to new Sales Order',    onClick: () => copyToNewSo(row) },
          { divider: true },
          { label: 'Delete', danger: true,       onClick: () => doDelete(row) },
        ]}
      />
    </div>
  );
};

const STORAGE_KEY = 'pr-g.so-list.layout.v1';

/* buildColumns — declared as a function so the component can pass a fresh
   `staffById` map every render (memoized inside the component to avoid
   invalidating DataGrid's column memo on every keystroke). Column set is
   driven by the actual `mfg_sales_orders` schema, not AutoCount. */
const buildColumns = (
  staffById: Map<string, string>,
): DataGridColumn<SoRow>[] => [
  {
    key: 'doc_no', label: 'Doc. No.', width: 110, sortable: true, groupable: false,
    accessor: (r) => <span className={styles.docNo}>{r.doc_no}</span>,
    searchValue: (r) => r.doc_no,
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
    key: 'debtor_code', label: 'Customer Code', width: 120, sortable: true,
    accessor: (r) => r.debtor_code ?? '',
    searchValue: (r) => r.debtor_code ?? '',
  },
  {
    key: 'debtor_name', label: 'Customer Name', width: 220, sortable: true, groupable: true,
    accessor: (r) => r.debtor_name,
    searchValue: (r) => r.debtor_name,
  },
  {
    /* Salesperson display = staff.name lookup. We carry salesperson_id on
       the row; the staff list is fetched once via useStaff and cached. */
    key: 'salesperson_id', label: 'Salesperson', width: 140, sortable: true, groupable: true,
    accessor: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '' : ''),
    searchValue: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '' : ''),
    groupValue: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '—' : '—'),
  },
  {
    key: 'customer_so_no', label: 'Customer SO Ref', width: 140, sortable: true,
    accessor: (r) => r.customer_so_no ?? '',
    searchValue: (r) => r.customer_so_no ?? '',
  },
  {
    /* Task #91 — display the pretty Malaysian format. searchValue keeps the
       raw stored value so a user can paste either form into Find and match. */
    key: 'phone', label: 'Phone', width: 130, sortable: true,
    accessor: (r) => formatPhone(r.phone) || '',
    searchValue: (r) => `${r.phone ?? ''} ${formatPhone(r.phone) ?? ''}`,
  },
  {
    key: 'email', label: 'Email', width: 180, sortable: true,
    accessor: (r) => r.email ?? '',
    searchValue: (r) => r.email ?? '',
  },
  {
    key: 'customer_type', label: 'Customer Type', width: 120, sortable: true, groupable: true,
    accessor: (r) => r.customer_type ?? '',
    searchValue: (r) => r.customer_type ?? '',
  },
  {
    key: 'building_type', label: 'Building Type', width: 120, sortable: true, groupable: true,
    accessor: (r) => r.building_type ?? '',
    searchValue: (r) => r.building_type ?? '',
  },
  {
    key: 'venue', label: 'Venue', width: 130, sortable: true, groupable: true,
    accessor: (r) => r.venue ?? '',
    searchValue: (r) => r.venue ?? '',
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
    key: 'customer_state', label: 'State', width: 130, sortable: true, groupable: true,
    accessor: (r) => r.customer_state ?? '',
    searchValue: (r) => r.customer_state ?? '',
  },
  {
    key: 'city', label: 'City', width: 130, sortable: true, groupable: true,
    accessor: (r) => r.city ?? '',
    searchValue: (r) => r.city ?? '',
  },
  {
    key: 'postcode', label: 'Postcode', width: 100, sortable: true,
    accessor: (r) => r.postcode ?? '',
    searchValue: (r) => r.postcode ?? '',
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
    key: 'note', label: 'Note', width: 200, sortable: true,
    accessor: (r) => r.note ?? '',
    searchValue: (r) => r.note ?? '',
  },
  {
    key: 'local_total_centi', label: 'Local Total', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.local_total_centi)}</span>,
    searchValue: (r) => fmtRm(r.local_total_centi),
    sortFn: (a, b) => a.local_total_centi - b.local_total_centi,
  },
  /* Task #114 — Category revenue + cost pairs. The grid is wide enough
     that not every user will want these visible, but they exist on the
     header (migration 0079) so the right-click "Show column" affordance
     can surface them. Listed in revenue/cost pairs so they sort naturally
     in the column menu. */
  {
    key: 'mattress_sofa_centi', label: 'Mattress/Sofa', width: 130, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.mattress_sofa_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.mattress_sofa_centi ?? 0),
    sortFn: (a, b) => (a.mattress_sofa_centi ?? 0) - (b.mattress_sofa_centi ?? 0),
  },
  {
    key: 'mattress_sofa_cost_centi', label: 'Mattress/Sofa Cost', width: 140, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.mattress_sofa_cost_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.mattress_sofa_cost_centi ?? 0),
    sortFn: (a, b) => (a.mattress_sofa_cost_centi ?? 0) - (b.mattress_sofa_cost_centi ?? 0),
  },
  {
    key: 'bedframe_centi', label: 'Bedframe', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.bedframe_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.bedframe_centi ?? 0),
    sortFn: (a, b) => (a.bedframe_centi ?? 0) - (b.bedframe_centi ?? 0),
  },
  {
    key: 'bedframe_cost_centi', label: 'Bedframe Cost', width: 130, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.bedframe_cost_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.bedframe_cost_centi ?? 0),
    sortFn: (a, b) => (a.bedframe_cost_centi ?? 0) - (b.bedframe_cost_centi ?? 0),
  },
  {
    key: 'accessories_centi', label: 'Accessories', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.accessories_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.accessories_centi ?? 0),
    sortFn: (a, b) => (a.accessories_centi ?? 0) - (b.accessories_centi ?? 0),
  },
  {
    key: 'accessories_cost_centi', label: 'Accessories Cost', width: 140, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.accessories_cost_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.accessories_cost_centi ?? 0),
    sortFn: (a, b) => (a.accessories_cost_centi ?? 0) - (b.accessories_cost_centi ?? 0),
  },
  {
    key: 'others_centi', label: 'Others', width: 110, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.others_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.others_centi ?? 0),
    sortFn: (a, b) => (a.others_centi ?? 0) - (b.others_centi ?? 0),
  },
  {
    key: 'others_cost_centi', label: 'Others Cost', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.others_cost_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.others_cost_centi ?? 0),
    sortFn: (a, b) => (a.others_cost_centi ?? 0) - (b.others_cost_centi ?? 0),
  },
  /* Task #114 — Overall cost / margin / margin% on the SO header. Wired
     through recomputeTotals on every line mutation. Margin column color
     follows the same Houzs ladder used on the detail page. */
  {
    key: 'total_cost_centi', label: 'Cost Total', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.total_cost_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.total_cost_centi ?? 0),
    sortFn: (a, b) => (a.total_cost_centi ?? 0) - (b.total_cost_centi ?? 0),
  },
  {
    key: 'total_margin_centi', label: 'Margin', width: 120, sortable: true, align: 'right', groupable: false,
    accessor: (r) => {
      const m = r.total_margin_centi ?? 0;
      if ((r.local_total_centi ?? 0) <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      const color = m > 0 ? 'var(--c-secondary-a, #2F5D4F)' : m < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
      return <span className={styles.money} style={{ color, fontWeight: 600 }}>{fmtRm(m)}</span>;
    },
    searchValue: (r) => fmtRm(r.total_margin_centi ?? 0),
    sortFn: (a, b) => (a.total_margin_centi ?? 0) - (b.total_margin_centi ?? 0),
  },
  {
    key: 'margin_pct_basis', label: 'Margin %', width: 100, sortable: true, align: 'right', groupable: false,
    accessor: (r) => {
      if ((r.local_total_centi ?? 0) <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      const pct = (r.margin_pct_basis ?? 0) / 100;
      const color = pct >= 50 ? 'var(--c-secondary-a, #2F5D4F)'
        : pct >= 30 ? 'var(--c-festive-a, #C77F3E)'
        : pct > 0   ? 'var(--c-burnt)'
        : 'var(--c-festive-b, #B8331F)';
      return <span style={{
        color, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
      }}>{pct.toFixed(1)}%</span>;
    },
    searchValue: (r) => `${((r.margin_pct_basis ?? 0) / 100).toFixed(1)}%`,
    sortFn: (a, b) => (a.margin_pct_basis ?? 0) - (b.margin_pct_basis ?? 0),
  },
  {
    key: 'deposit_centi', label: 'Deposit', width: 110, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.deposit_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.deposit_centi ?? 0),
    sortFn: (a, b) => (a.deposit_centi ?? 0) - (b.deposit_centi ?? 0),
  },
  {
    key: 'paid_total_centi', label: 'Paid', width: 110, sortable: true, align: 'right', groupable: false,
    accessor: (r) => <span className={styles.money}>{fmtRm(r.paid_total_centi ?? r.paid_centi ?? 0)}</span>,
    searchValue: (r) => fmtRm(r.paid_total_centi ?? r.paid_centi ?? 0),
    sortFn: (a, b) => (a.paid_total_centi ?? a.paid_centi ?? 0) - (b.paid_total_centi ?? b.paid_centi ?? 0),
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
    key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
    accessor: (r) => <StatusPill status={r.status} />,
    searchValue: (r) => r.status,
    groupValue: (r) => r.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
];
