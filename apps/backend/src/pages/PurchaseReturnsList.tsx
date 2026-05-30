// ----------------------------------------------------------------------------
// PurchaseReturnsList — Purchase Return (PR) list, cloned from the polished
// Goods Received list (GoodsReceivedList.tsx). Same DataGrid UX:
//   • double-click a row → open the PR detail page
//   • right-click → context menu ("Open")
//
// A Purchase Return is born from a Goods Receipt: the user converts a GRN
// (right-click "Convert to PR" on the GRN list, or the "From GRN" button here
// routes to /grns). A manual New Return page exists at /purchase-returns/new.
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Undo2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { usePurchaseReturns, useCancelPurchaseReturn } from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// purchase_return_status enum: POSTED / COMPLETED / CANCELLED. Tints mirror
// the GRN list. POSTED reads as "Confirmed" — no Draft/lifecycle exposed.
const STATUS_COLOR: Record<string, string> = {
  POSTED: 'rgba(47, 93, 79, 0.12)',
  COMPLETED: 'rgba(31, 58, 138, 0.10)',
  CANCELLED: 'rgba(184, 51, 31, 0.10)',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED: 'Confirmed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const fmtMoney = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* New unique storage key — NEVER reuse the GRN/PO list key. */
const PR_LIST_STORAGE_KEY = 'pr-list.layout.v1';

/* The list endpoint embeds supplier + purchase_order + grn + the header's
   refund_centi. Rows stay loosely typed — accessors read by name. */
type PrRow = Record<string, unknown> & {
  id: string;
  return_number: string;
  status: string;
  return_date: string | null;
  refund_centi?: number;
  supplier?: { id: string; code: string; name: string } | null;
  purchase_order?: { id: string; po_number: string } | null;
  grn?: { id: string; grn_number: string } | null;
};

const buildPrColumns = (): DataGridColumn<PrRow>[] => [
  {
    key: 'return_number', label: 'Return No.', width: 150, sortable: true,
    accessor: (r) => <span className={styles.codeChip}>{r.return_number}</span>,
    searchValue: (r) => r.return_number,
    sortFn: (a, b) => a.return_number.localeCompare(b.return_number),
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
    key: 'grn_number', label: 'From GRN', width: 150, sortable: true, groupable: true,
    accessor: (r) => <span className={styles.codeChip}>{r.grn?.grn_number ?? '—'}</span>,
    searchValue: (r) => r.grn?.grn_number ?? '',
    groupValue: (r) => r.grn?.grn_number ?? '(none)',
  },
  {
    key: 'return_date', label: 'Return Date', width: 120, sortable: true,
    accessor: (r) => (r.return_date ?? '').slice(0, 10) || '—',
    searchValue: (r) => r.return_date ?? '',
    sortFn: (a, b) => String(a.return_date ?? '').localeCompare(String(b.return_date ?? '')),
  },
  {
    key: 'refund_centi', label: 'Refund', width: 130, sortable: true, align: 'right', groupable: false,
    accessor: (r) => (
      <span style={{ fontFamily: 'var(--font-mark)', color: 'var(--c-burnt)', fontWeight: 800 }}>
        {fmtMoney(Number(r.refund_centi ?? 0))}
      </span>
    ),
    searchValue: (r) => fmtMoney(Number(r.refund_centi ?? 0)),
    sortFn: (a, b) => Number(a.refund_centi ?? 0) - Number(b.refund_centi ?? 0),
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

export const PurchaseReturns = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = usePurchaseReturns();
  const cancelPr = useCancelPurchaseReturn();

  const rows = useMemo<PrRow[]>(() => (data?.purchaseReturns ?? []) as PrRow[], [data]);
  const columns = useMemo(() => buildPrColumns(), []);

  // Cancel a PR (right-click) — reverses the return server-side (stock goes back
  // in). Confirm first. Mirrors the GRN list's doCancelGrn.
  const doCancelPr = (r: PrRow) => {
    if (!window.confirm(`Cancel return ${r.return_number}? This reverses the return — the goods are put back into stock. Line items stay for audit.`)) return;
    cancelPr.mutate(r.id, {
      onError: (e) => alert(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Purchase Returns</h1>
          <p className={styles.subtitle}>Goods sent back to suppliers</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {/* A Purchase Return starts from a Goods Receipt — this routes to the
              GRN list where the user right-clicks "Convert to PR". */}
          <Button variant="ghost" size="md" onClick={() => navigate('/grns')}>
            <Undo2 {...ICON} />
            <span>From GRN</span>
          </Button>
          <Button variant="primary" size="md" onClick={() => navigate('/purchase-returns/new')}>
            <Plus {...ICON} />
            <span>New Return</span>
          </Button>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading returns…' : `${rows.length} purchase returns`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load purchase returns.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid<PrRow>
        rows={rows}
        columns={columns}
        storageKey={PR_LIST_STORAGE_KEY}
        rowKey={(r) => r.id}
        searchPlaceholder="Search returns…"
        /* Open on DOUBLE-click; right-click → context menu (mirrors the GRN list). */
        onRowDoubleClick={(r) => navigate(`/purchase-returns/${r.id}`)}
        /* Completed / cancelled returns grey out so they read as locked / done. */
        rowStyle={(r) => r.status === 'COMPLETED' || r.status === 'CANCELLED'
          ? { opacity: 0.6, filter: 'grayscale(0.4)' }
          : undefined}
        contextMenu={(r) => {
          // Mirror the PO/GRN list's right-click menu: View / Edit · divider ·
          // Cancel (danger). View opens read-only; Edit lands on the detail page
          // with ?edit=1 (the draft-edit gate flips straight into Edit mode).
          const menu: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'View', onClick: () => navigate(`/purchase-returns/${r.id}`) },
            { label: 'Edit', onClick: () => navigate(`/purchase-returns/${r.id}?edit=1`) },
          ];
          // Cancel — soft-stop. Hidden once cancelled / completed.
          if (r.status !== 'CANCELLED' && r.status !== 'COMPLETED') {
            menu.push({ divider: true as const });
            menu.push({ label: 'Cancel', danger: true, onClick: () => doCancelPr(r) });
          }
          return menu;
        }}
        isLoading={isLoading}
        emptyMessage='No returns yet — convert a Goods Receipt via "From GRN".'
      />
    </div>
  );
};
