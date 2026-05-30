// ----------------------------------------------------------------------------
// PurchaseConsignmentsList — buyer-side Purchase Consignment (PC) list, cloned
// from the polished GoodsReceivedList structure (DataGrid-based).
//   • Double-click row → /purchase-consignment/:id
//   • Right-click row → View / Edit / Cancel-note-from-row
// The "New PC" primary button drops you onto the detail page (creation happens
// inline once the parent shell is in place); PC creation modal lives in a
// follow-up PR — for now we keep parity with GoodsReceivedList's New button
// behaviour (navigate stub).
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  usePurchaseConsignments,
  useCreatePurchaseConsignment,
  useCancelPurchaseConsignmentNote,
  usePurchaseConsignmentDetail,
} from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './Suppliers.module.css';

/* ── L2 expansion for the PC parent list — items + notes summary ──────────
   Fetches the PC detail (items + notes) when the row expands; gated by
   `enabled: !!id` inside the hook. Mirrors ExpandedConsignmentLines in
   FlowPages.tsx (CO list) — a small inline table the user can glance at
   without leaving the list. */
const ExpandedPcLines = ({ id }: { id: string }) => {
  const q = usePurchaseConsignmentDetail(id);
  if (q.isLoading) {
    return <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>Loading PC…</div>;
  }
  if (q.error) {
    return (
      <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--c-festive-b, #B8331F)' }}>
        Failed to load: {q.error instanceof Error ? q.error.message : String(q.error)}
      </div>
    );
  }
  const items: any[] = q.data?.items ?? [];
  const notes: any[] = q.data?.notes ?? [];
  const TH: CSSProperties = { padding: '2px 8px', textAlign: 'left', color: 'var(--fg-muted)', fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)', letterSpacing: '0.06em', textTransform: 'uppercase' };
  const THR: CSSProperties = { ...TH, textAlign: 'right' };
  const TD: CSSProperties = { padding: '3px 8px', verticalAlign: 'top' };
  const TDR: CSSProperties = { ...TD, textAlign: 'right' };
  const noteSummaries = notes.map((n: any) => ({
    id: n.id, no: n.note_number, type: n.note_type, date: n.note_date,
    status: n.cancelled_at ? 'Cancelled' : (n.signed_at ? 'Posted' : 'Draft'),
  }));
  return (
    <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-2) 40px', background: 'var(--c-cream)', display: 'grid', gap: 'var(--space-3)' }}>
      <div>
        <div style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4 }}>Items placed</div>
        {items.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>No items.</div>
        ) : (
          <table style={{ width: 760, borderCollapse: 'collapse', fontSize: 'var(--fs-11)', fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
            <thead><tr style={{ borderBottom: '1px solid rgba(34,31,32,0.10)' }}>
              <th style={{ ...TH, width: 160 }}>Material Code</th>
              <th style={{ ...TH, width: 320 }}>Description</th>
              <th style={{ ...THR, width: 70 }}>Placed</th>
              <th style={{ ...THR, width: 70 }}>Sold</th>
              <th style={{ ...THR, width: 80 }}>Returned</th>
              <th style={{ ...THR, width: 80 }}>Damaged</th>
            </tr></thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id} style={{ borderTop: '1px solid rgba(34,31,32,0.05)' }}>
                  <td style={{ ...TD, fontWeight: 700, color: 'var(--c-burnt)' }}>{it.material_code ?? '—'}</td>
                  <td style={TD}>{it.material_name ?? it.description ?? '—'}</td>
                  <td style={TDR}>{it.qty_placed ?? 0}</td>
                  <td style={TDR}>{it.qty_sold ?? 0}</td>
                  <td style={TDR}>{it.qty_returned ?? 0}</td>
                  <td style={TDR}>{it.qty_damaged ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4 }}>Notes ({noteSummaries.length})</div>
        {noteSummaries.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>No notes posted yet.</div>
        ) : (
          <table style={{ width: 520, borderCollapse: 'collapse', fontSize: 'var(--fs-11)', fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
            <thead><tr style={{ borderBottom: '1px solid rgba(34,31,32,0.10)' }}>
              <th style={{ ...TH, width: 150 }}>Note No.</th>
              <th style={{ ...TH, width: 80 }}>Type</th>
              <th style={{ ...TH, width: 120 }}>Date</th>
              <th style={{ ...TH, width: 100 }}>Status</th>
            </tr></thead>
            <tbody>
              {noteSummaries.map((n) => (
                <tr key={n.id} style={{ borderTop: '1px solid rgba(34,31,32,0.05)' }}>
                  <td style={{ ...TD, fontWeight: 700, color: 'var(--c-burnt)' }}>{n.no}</td>
                  <td style={TD}>{n.type}</td>
                  <td style={TD}>{(n.date ?? '').slice(0, 10) || '—'}</td>
                  <td style={TD}>{n.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// PC status enum: AT_WAREHOUSE / SOLD / RETURNED / DAMAGED. Tints mirror the
// consignment list (it uses the same shape just with debtor vs supplier).
const STATUS_COLOR: Record<string, string> = {
  AT_WAREHOUSE: 'rgba(47, 93, 79, 0.12)',
  SOLD:         'rgba(31, 58, 138, 0.10)',
  RETURNED:     'rgba(99, 99, 99, 0.10)',
  DAMAGED:      'rgba(184, 51, 31, 0.10)',
};
const STATUS_LABEL: Record<string, string> = {
  AT_WAREHOUSE: 'At Warehouse',
  SOLD:         'Sold',
  RETURNED:     'Returned',
  DAMAGED:      'Damaged',
};

/* Unique storage key — never reused. */
const PC_LIST_STORAGE_KEY = 'pc-list.layout.v1';

type PcRow = Record<string, unknown> & {
  id: string;
  pc_number: string;
  status: string;
  agreement_date: string | null;
  supplier_id: string | null;
  warehouse_id: string | null;
  notes: string | null;
  /* Migration 0111 — surfaced by the list endpoint */
  has_children?: boolean;
  fully_sold?: boolean;
  fully_returned?: boolean;
};

const buildPcColumns = (): DataGridColumn<PcRow>[] => [
  {
    key: 'pc_number', label: 'PC No.', width: 150, sortable: true,
    accessor: (g) => <span className={styles.codeChip}>{g.pc_number}</span>,
    searchValue: (g) => g.pc_number,
    sortFn: (a, b) => a.pc_number.localeCompare(b.pc_number),
  },
  {
    key: 'agreement_date', label: 'Agreement Date', width: 130, sortable: true,
    accessor: (g) => (g.agreement_date ?? '').slice(0, 10) || '—',
    searchValue: (g) => g.agreement_date ?? '',
    sortFn: (a, b) => String(a.agreement_date ?? '').localeCompare(String(b.agreement_date ?? '')),
  },
  {
    key: 'supplier_id', label: 'Supplier', width: 240, sortable: true, groupable: true,
    accessor: (g) => g.supplier_id ?? '—',
    searchValue: (g) => g.supplier_id ?? '',
    groupValue: (g) => g.supplier_id ?? '(none)',
  },
  {
    key: 'notes', label: 'Notes', width: 240, sortable: false, defaultHidden: true,
    accessor: (g) => g.notes ?? '—',
    searchValue: (g) => g.notes ?? '',
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

export const PurchaseConsignmentsList = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = usePurchaseConsignments();
  const createPc = useCreatePurchaseConsignment();
  const cancelNote = useCancelPurchaseConsignmentNote();
  const [cancelFor, setCancelFor] = useState<string | null>(null);

  const rows = useMemo<PcRow[]>(() => (data?.purchaseConsignments ?? []) as PcRow[], [data]);
  const columns = useMemo(() => buildPcColumns(), []);

  // Right-click "Cancel note from row" — opens a tiny picker modal that lists
  // the active notes for the selected PC, lets the user choose one to cancel.
  const onCancelRow = (g: PcRow) => setCancelFor(g.id);

  // Bare-bones New PC — POST with a single placeholder line, then navigate to
  // the detail page where the user fills in the real data + items. Mirrors the
  // "New GRN drops you on /grns/new" pattern.
  const onNew = () => {
    const supplierId = prompt('Supplier UUID for the new Purchase Consignment? (you can edit details on the next page)');
    if (!supplierId) return;
    createPc.mutate(
      {
        supplierId,
        items: [{ materialCode: 'PLACEHOLDER', materialName: 'Placeholder line — edit me', qtyPlaced: 1 }],
      },
      {
        onSuccess: (res) => navigate(`/purchase-consignment/${res.id}`),
        onError: (e) => alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`),
      },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Purchase Consignment</h1>
          <p className={styles.subtitle}>Supplier-owned stock at your warehouse — IN / RETURN notes</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="primary" size="md" onClick={onNew}>
            <Plus {...ICON} />
            <span>New PC</span>
          </Button>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading purchase consignments…' : `${rows.length} purchase consignments`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load Purchase Consignments.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid<PcRow>
        rows={rows}
        columns={columns}
        storageKey={PC_LIST_STORAGE_KEY}
        rowKey={(g) => g.id}
        searchPlaceholder="Search PCs…"
        onRowDoubleClick={(g) => navigate(`/purchase-consignment/${g.id}`)}
        expandable={{
          renderExpansion: (row) => <ExpandedPcLines id={row.id} />,
          rowExpansionKey: (row) => row.id,
        }}
        rowStyle={(g) => (g.status === 'RETURNED' || g.status === 'DAMAGED')
          ? { opacity: 0.55, filter: 'grayscale(0.6)' }
          : undefined}
        contextMenu={(g) => {
          const menu: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'View', onClick: () => navigate(`/purchase-consignment/${g.id}`) },
          ];
          // Edit — only when no posted/active note exists.
          if (!g.has_children) {
            menu.push({ label: 'Edit', onClick: () => navigate(`/purchase-consignment/${g.id}?edit=1`) });
          }
          // Cancel-note-from-row — only meaningful when there IS a posted note.
          if (g.has_children) {
            menu.push({ divider: true as const });
            menu.push({ label: 'Cancel note…', danger: true, onClick: () => onCancelRow(g) });
          }
          return menu;
        }}
        isLoading={isLoading}
        emptyMessage='No Purchase Consignments yet — click "New PC" to start.'
      />

      {cancelFor && (
        <CancelNotePicker
          pcId={cancelFor}
          onClose={() => setCancelFor(null)}
          onCancel={(noteId) => {
            cancelNote.mutate(
              { id: cancelFor, noteId },
              {
                onSuccess: () => setCancelFor(null),
                onError: (e) => alert(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`),
              },
            );
          }}
        />
      )}
    </div>
  );
};

/* Small picker modal — fetches the PC detail, lists active (non-cancelled)
   notes, lets the user click one to cancel. Inline so the list page stays
   self-contained. */
const CancelNotePicker = ({
  pcId,
  onClose,
  onCancel,
}: {
  pcId: string;
  onClose: () => void;
  onCancel: (noteId: string) => void;
}) => {
  const detail = usePurchaseConsignmentDetail(pcId);
  const notes = (detail.data?.notes as Array<{ id: string; note_number: string; note_type: string; cancelled_at: string | null; signed_at: string | null }> | undefined) ?? [];
  const active = notes.filter((n) => !n.cancelled_at);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.40)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-cream, #fff)', borderRadius: 8,
          padding: 'var(--space-4)', minWidth: 360, maxWidth: 520,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Cancel a posted note</h3>
        {detail.isLoading && <p>Loading…</p>}
        {!detail.isLoading && active.length === 0 && (
          <p>No active notes to cancel.</p>
        )}
        {!detail.isLoading && active.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {active.map((n) => (
              <li key={n.id} style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!confirm(`Cancel ${n.note_number}? This reverses the inventory movement.`)) return;
                    onCancel(n.id);
                  }}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '8px 12px', borderRadius: 4,
                    border: '1px solid var(--c-orange)', cursor: 'pointer',
                    background: 'transparent',
                  }}
                >
                  <strong>{n.note_number}</strong>
                  <span style={{ color: 'var(--c-burnt)', marginLeft: 8 }}>{n.note_type}</span>
                  <span style={{ color: '#666', marginLeft: 8 }}>
                    {n.signed_at ? 'posted' : 'draft'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
};
