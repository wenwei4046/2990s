// ----------------------------------------------------------------------------
// PurchaseInvoicesList — Purchase Invoice (PI) list, cloned from the polished
// Purchase Returns list (PurchaseReturnsList.tsx). Same DataGrid UX:
//   • double-click a row → open the PI detail page
//   • right-click → context menu ("Open")
//
// A Purchase Invoice is born from a Goods Receipt: the user converts a GRN
// (right-click "Convert to PI" on the GRN list, or the "From GRN" button here
// routes to /grns). A manual New Invoice page exists at /purchase-invoices/new.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { usePurchaseInvoices, useCancelPurchaseInvoice } from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { fmtDateOrDash } from '@2990s/shared';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// purchase_invoice_status enum: POSTED / PARTIALLY_PAID / PAID / CANCELLED.
// Tints use the shared lifecycle palette (PO/SO): confirmed=burnt,
// in-progress=darker burnt, complete=green, void=red.
const STATUS_COLOR: Record<string, string> = {
  POSTED: 'rgba(166, 71, 30, 0.12)',
  PARTIALLY_PAID: 'rgba(166, 71, 30, 0.18)',
  PAID: 'rgba(47, 93, 79, 0.28)',
  CANCELLED: 'rgba(184, 51, 31, 0.10)',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED: 'Confirmed',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
};

const fmtMoney = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* New unique storage key — NEVER reuse the GRN/PR/PO list key. */
const PI_LIST_STORAGE_KEY = 'pi-list.layout.v1';

/* The list endpoint embeds supplier + purchase_order + grn + the header's
   total_centi. Rows stay loosely typed — accessors read by name. */
type PiRow = Record<string, unknown> & {
  id: string;
  invoice_number: string;
  status: string;
  invoice_date: string | null;
  due_date: string | null;
  total_centi?: number;
  paid_centi?: number;
  currency?: string;
  supplier?: { id: string; code: string; name: string } | null;
  purchase_order?: { id: string; po_number: string } | null;
  grn?: { id: string; grn_number: string } | null;
};

const buildPiColumns = (): DataGridColumn<PiRow>[] => [
  {
    key: 'invoice_number', label: 'Invoice No.', width: 150, sortable: true,
    accessor: (r) => <span style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>{r.invoice_number}</span>,
    searchValue: (r) => r.invoice_number,
    sortFn: (a, b) => a.invoice_number.localeCompare(b.invoice_number),
  },
  {
    key: 'supplier', label: 'Supplier', width: 220, sortable: true, groupable: true,
    accessor: (r) => r.supplier?.name ?? r.supplier?.code ?? '—',
    searchValue: (r) => `${r.supplier?.name ?? ''} ${r.supplier?.code ?? ''}`.trim(),
    groupValue: (r) => r.supplier?.name ?? r.supplier?.code ?? '(none)',
    sortFn: (a, b) =>
      (a.supplier?.name ?? a.supplier?.code ?? '').localeCompare(b.supplier?.name ?? b.supplier?.code ?? ''),
  },
  {
    key: 'source_ref', label: 'From GRN/PO', width: 160, sortable: true, groupable: true,
    accessor: (r) => (
      <span style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>{r.grn?.grn_number ?? r.purchase_order?.po_number ?? '—'}</span>
    ),
    searchValue: (r) => `${r.grn?.grn_number ?? ''} ${r.purchase_order?.po_number ?? ''}`.trim(),
    groupValue: (r) => r.grn?.grn_number ?? r.purchase_order?.po_number ?? '(none)',
  },
  {
    key: 'invoice_date', label: 'Invoice Date', width: 120, sortable: true,
    accessor: (r) => fmtDateOrDash(r.invoice_date),
    searchValue: (r) => r.invoice_date ?? '',
    sortFn: (a, b) => String(a.invoice_date ?? '').localeCompare(String(b.invoice_date ?? '')),
  },
  {
    key: 'due_date', label: 'Due Date', width: 120, sortable: true,
    accessor: (r) => fmtDateOrDash(r.due_date),
    searchValue: (r) => r.due_date ?? '',
    sortFn: (a, b) => String(a.due_date ?? '').localeCompare(String(b.due_date ?? '')),
  },
  {
    key: 'total_centi', label: 'Total', width: 130, sortable: true, align: 'right', groupable: false,
    accessor: (r) => (
      <span style={{ fontFamily: 'var(--font-mark)', color: 'var(--c-burnt)', fontWeight: 800 }}>
        {fmtMoney(Number(r.total_centi ?? 0), r.currency)}
      </span>
    ),
    searchValue: (r) => fmtMoney(Number(r.total_centi ?? 0), r.currency),
    sortFn: (a, b) => Number(a.total_centi ?? 0) - Number(b.total_centi ?? 0),
  },
  {
    key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
    accessor: (r) => (
      <span className={styles.statusPill} style={{ background: STATUS_COLOR[r.status] }}>
        {STATUS_LABEL[r.status] ?? r.status.replace('_', ' ')}
      </span>
    ),
    searchValue: (r) => STATUS_LABEL[r.status] ?? r.status.replace('_', ' '),
    groupValue: (r) => STATUS_LABEL[r.status] ?? r.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
];

export const PurchaseInvoices = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = usePurchaseInvoices();
  const cancelPi = useCancelPurchaseInvoice();

  const rows = useMemo<PiRow[]>(() => (data?.purchaseInvoices ?? []) as PiRow[], [data]);
  const columns = useMemo(() => buildPiColumns(), []);

  // Cancel a PI (right-click) — flips status → CANCELLED (PI is AP-only, no
  // inventory). Confirm first; the endpoint blocks a PAID invoice.
  const doCancelPi = (r: PiRow) => {
    if (!window.confirm(`Cancel invoice ${r.invoice_number}? This sets status to CANCELLED — line items stay for audit.`)) return;
    cancelPi.mutate(r.id, {
      onError: (e) => alert(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Purchase Invoices</h1>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {/* A Purchase Invoice starts from a Goods Receipt — this routes to the
              GRN list where the user right-clicks "Convert to PI". */}
          <Button variant="ghost" size="md" onClick={() => navigate('/grns')}>
            <FileText {...ICON} />
            <span>From Goods Receipt</span>
          </Button>
          <Button variant="primary" size="md" onClick={() => navigate('/purchase-invoices/new')}>
            <Plus {...ICON} />
            <span>New Purchase Invoice</span>
          </Button>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading invoices…' : `${rows.length} purchase invoices`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load purchase invoices.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid<PiRow>
        rows={rows}
        columns={columns}
        storageKey={PI_LIST_STORAGE_KEY}
        rowKey={(r) => r.id}
        searchPlaceholder="Search invoices…"
        /* Open on DOUBLE-click; right-click → context menu (mirrors the GRN/PR list). */
        onRowDoubleClick={(r) => navigate(`/purchase-invoices/${r.id}`)}
        /* Cancelled invoices grey out so they read as locked / void. */
        rowStyle={(r) => r.status === 'CANCELLED'
          ? { opacity: 0.6, filter: 'grayscale(0.4)' }
          : undefined}
        contextMenu={(r) => {
          // Unified edit-lock (migration 0106): a PI is read-only once it has any
          // payment (paid_centi > 0) or is CANCELLED. Edit + Cancel are HIDDEN
          // when not eligible. View always available.
          const locked = r.status === 'CANCELLED' || (r.paid_centi ?? 0) > 0;
          const menu: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'View', onClick: () => navigate(`/purchase-invoices/${r.id}`) },
          ];
          if (!locked) {
            menu.push({ label: 'Edit', onClick: () => navigate(`/purchase-invoices/${r.id}?edit=1`) });
            menu.push({ divider: true as const });
            menu.push({ label: 'Cancel', danger: true, onClick: () => doCancelPi(r) });
          }
          return menu;
        }}
        isLoading={isLoading}
        emptyMessage='No invoices yet — convert a Goods Receipt via "From Goods Receipt".'
      />
    </div>
  );
};
