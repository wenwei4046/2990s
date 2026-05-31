// ----------------------------------------------------------------------------
// GoodsReceivedList — Goods Received Note (GRN) list, cloned from the polished
// Purchase Orders list (PurchaseOrders.tsx). Same DataGrid UX:
//   • double-click a row → open the GRN detail page
//   • right-click → context menu (View · Edit · Convert to PI · Convert to PR)
//
// The legacy CreatePoDrawer / DetailPoDrawer below the PO list were NOT cloned
// (dead code). GRN creation stays on the existing /grns/new + /grns/from-po
// pages — this list just adds the New GRN button.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useGrns,
  usePurchaseReturnFromGrn,
  useCancelGrn,
} from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// GRN status set (grn_status enum): POSTED / CLOSED / CANCELLED. Tints mirror
// the PO list.
const STATUS_COLOR: Record<string, string> = {
  POSTED:    'rgba(47, 93, 79, 0.12)',
  CLOSED:    'rgba(31, 58, 138, 0.10)',
  CANCELLED: 'rgba(184, 51, 31, 0.10)',
};
// A GRN has no draft/lifecycle — POSTED reads as "Confirmed". No raw POSTED.
const STATUS_LABEL: Record<string, string> = {
  POSTED:    'Confirmed',
  CLOSED:    'Closed',
  CANCELLED: 'Cancelled',
};

const fmtMoney = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* New unique storage key — NEVER reuse the PO list key. */
const GRN_LIST_STORAGE_KEY = 'grn-list.layout.v1';

/* The list endpoint embeds supplier + purchase_order + a computed total_centi.
   Rows stay loosely typed (the GRN list endpoint returns row shape per migration
   0101 + the existing joins) — accessors read by name. */
type GrnRow = Record<string, unknown> & {
  id: string;
  grn_number: string;
  status: string;
  received_at: string | null;
  delivery_note_ref: string | null;
  total_centi?: number;
  currency?: string;
  supplier?: { id: string; code: string; name: string } | null;
  purchase_order?: { id: string; po_number: string } | null;
  /* Migration 0106 — convert-eligibility / lock flags from the list endpoint. */
  has_children?: boolean;
  fully_invoiced?: boolean;
  fully_returned?: boolean;
};

const buildGrnColumns = (): DataGridColumn<GrnRow>[] => [
  {
    key: 'grn_number', label: 'GRN No.', width: 150, sortable: true,
    accessor: (g) => <span className={styles.codeChip}>{g.grn_number}</span>,
    searchValue: (g) => g.grn_number,
    sortFn: (a, b) => a.grn_number.localeCompare(b.grn_number),
  },
  {
    key: 'supplier', label: 'Supplier', width: 220, sortable: true, groupable: true,
    accessor: (g) => g.supplier?.name ?? g.supplier?.code ?? '—',
    searchValue: (g) => `${g.supplier?.name ?? ''} ${g.supplier?.code ?? ''}`.trim(),
    groupValue: (g) => g.supplier?.name ?? g.supplier?.code ?? '(none)',
    sortFn: (a, b) =>
      (a.supplier?.name ?? a.supplier?.code ?? '').localeCompare(b.supplier?.name ?? b.supplier?.code ?? ''),
  },
  {
    key: 'po_number', label: 'From PO', width: 150, sortable: true, groupable: true,
    accessor: (g) => <span className={styles.codeChip}>{g.purchase_order?.po_number ?? '—'}</span>,
    searchValue: (g) => g.purchase_order?.po_number ?? '',
    groupValue: (g) => g.purchase_order?.po_number ?? '(none)',
  },
  {
    key: 'received_at', label: 'Received Date', width: 120, sortable: true,
    accessor: (g) => (g.received_at ?? '').slice(0, 10) || '—',
    searchValue: (g) => g.received_at ?? '',
    sortFn: (a, b) => String(a.received_at ?? '').localeCompare(String(b.received_at ?? '')),
  },
  {
    key: 'delivery_note_ref', label: 'DN Ref', width: 130, sortable: true, defaultHidden: true,
    accessor: (g) => g.delivery_note_ref ?? '—',
    searchValue: (g) => g.delivery_note_ref ?? '',
  },
  {
    key: 'total_centi', label: 'Total', width: 130, sortable: true, align: 'right', groupable: false,
    accessor: (g) => (
      <span style={{ fontFamily: 'var(--font-mark)', color: 'var(--c-burnt)', fontWeight: 800 }}>
        {fmtMoney(Number(g.total_centi ?? 0), g.currency)}
      </span>
    ),
    searchValue: (g) => fmtMoney(Number(g.total_centi ?? 0), g.currency),
    sortFn: (a, b) => Number(a.total_centi ?? 0) - Number(b.total_centi ?? 0),
  },
  {
    key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
    accessor: (g) => (
      <span className={styles.statusPill} style={{ background: STATUS_COLOR[g.status] }}>
        {STATUS_LABEL[g.status] ?? g.status.replace('_', ' ')}
      </span>
    ),
    searchValue: (g) => STATUS_LABEL[g.status] ?? g.status.replace('_', ' '),
    groupValue: (g) => STATUS_LABEL[g.status] ?? g.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
];

export const GoodsReceived = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGrns();
  const prFromGrn = usePurchaseReturnFromGrn();
  const cancelGrn = useCancelGrn();

  const rows = useMemo<GrnRow[]>(() => (data?.grns ?? []) as GrnRow[], [data]);
  const columns = useMemo(() => buildGrnColumns(), []);

  // Single-GRN convert (right-click) → open the New PI review screen pre-loaded
  // with this note's remaining lines. Nothing is invoiced until the operator
  // confirms prices/dates and clicks Create (matches the other modules).
  const convertToPi = (g: GrnRow) => {
    navigate(`/purchase-invoices/new?grnId=${encodeURIComponent(g.id)}`);
  };
  const convertToPr = (g: GrnRow) => {
    prFromGrn.mutate(g.id, {
      onSuccess: (res) => navigate(`/purchase-returns/${res.id}`),
      onError: (e) => alert(`Convert to PR failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };
  // Cancel a GRN (right-click) — reverses the receipt server-side. Confirm first.
  const doCancelGrn = (g: GrnRow) => {
    if (!window.confirm(`Cancel GRN ${g.grn_number}? This reverses the receipt — stock is taken back out and the source PO's received qty is rolled back. Line items stay for audit.`)) return;
    cancelGrn.mutate(g.id, {
      onError: (e) => alert(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Goods Received</h1>
          <p className={styles.subtitle}>Goods Received Notes from suppliers</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="md" onClick={() => navigate('/grns/from-po')}>
            <Plus {...ICON} />
            <span>From PO</span>
          </Button>
          <Button variant="primary" size="md" onClick={() => navigate('/grns/new')}>
            <Plus {...ICON} />
            <span>New GRN</span>
          </Button>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading GRNs…' : `${rows.length} goods received notes`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load GRNs.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid<GrnRow>
        rows={rows}
        columns={columns}
        storageKey={GRN_LIST_STORAGE_KEY}
        rowKey={(g) => g.id}
        searchPlaceholder="Search GRNs…"
        /* Open on DOUBLE-click; right-click → context menu (mirrors the PO list). */
        onRowDoubleClick={(g) => navigate(`/grns/${g.id}`)}
        /* Cancelled / Closed GRNs grey out so they read as dead (mirrors the PO list). */
        rowStyle={(g) => (g.status === 'CANCELLED' || g.status === 'CLOSED')
          ? { opacity: 0.55, filter: 'grayscale(0.6)' }
          : undefined}
        contextMenu={(g) => {
          // Unified convert / edit / cancel eligibility (migration 0106). Each
          // action is HIDDEN when not eligible:
          //   • Edit / Cancel  — only POSTED && no downstream child.
          //   • Convert to PI  — only POSTED && not fully invoiced.
          //   • Convert to PR  — only POSTED && not fully returned.
          const isPosted = g.status === 'POSTED';
          const hasChildren = Boolean(g.has_children);
          const menu: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'View', onClick: () => navigate(`/grns/${g.id}`) },
          ];
          // Edit — only when editable (POSTED, no child).
          if (isPosted && !hasChildren) {
            menu.push({ label: 'Edit', onClick: () => navigate(`/grns/${g.id}?edit=1`) });
          }
          // Convert actions — hidden when not eligible (fully consumed / not POSTED).
          const canPi = isPosted && !g.fully_invoiced;
          const canPr = isPosted && !g.fully_returned;
          if (canPi || canPr) {
            menu.push({ divider: true as const });
            if (canPi) menu.push({ label: 'Convert to PI', onClick: () => convertToPi(g) });
            if (canPr) menu.push({ label: 'Convert to PR', onClick: () => convertToPr(g) });
          }
          // Cancel — soft-stop. Only POSTED && no downstream child.
          if (isPosted && !hasChildren) {
            menu.push({ divider: true as const });
            menu.push({ label: 'Cancel', danger: true, onClick: () => doCancelGrn(g) });
          }
          return menu;
        }}
        isLoading={isLoading}
        emptyMessage='No GRNs yet — click "New GRN" to receive goods.'
      />
    </div>
  );
};
