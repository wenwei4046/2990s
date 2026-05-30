// ----------------------------------------------------------------------------
// ConsignmentReturnsList — COR list page. Flat view of consignment_notes
// WHERE note_type='RETURN' AND cancelled_at IS NULL, joined to the parent
// consignment header for context (debtor + parent doc no).
//
// Mirrors PurchaseConsignmentsList.tsx shape (DataGrid-based).
//   • Double-click row → /consignment/${parent_id} (parent detail page)
//   • L2 expansion → per-note line items inline (uses the nested items the
//     /notes/returns endpoint ships back, so no extra round trip).
//   • storageKey: 'cor-list.layout.v1'   ← unique, never reused
//
// This is a NOTE-level list (one row per RETURN note), so there is no "New COR"
// action here — RETURN notes are created from the parent CO detail page. The
// header still surfaces a primary action: "Go to Consignment" deep-link to the
// parent list, matching the menu structure ("CO" + "COR" living side by side
// under Sales Order in the sidebar).
// ----------------------------------------------------------------------------

import { useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useConsignmentReturns } from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* COR row status is derived server-side from cancelled_at/signed_at, but since
   we filter cancelled rows out of the list the only values that surface are
   POSTED (signed_at IS NOT NULL) and DRAFT (signed_at IS NULL). */
const STATUS_COLOR: Record<string, string> = {
  POSTED:    'rgba(47, 93, 79, 0.12)',
  DRAFT:     'rgba(31, 58, 138, 0.10)',
  CANCELLED: 'rgba(99, 99, 99, 0.10)',
};
const STATUS_LABEL: Record<string, string> = {
  POSTED:    'Posted',
  DRAFT:     'Draft',
  CANCELLED: 'Cancelled',
};

/* Unique storage key — never reused. */
const COR_LIST_STORAGE_KEY = 'cor-list.layout.v1';

type CorRow = Record<string, unknown> & {
  id: string;
  note_number: string;
  note_date: string | null;
  parent_id: string;
  parent_doc_no: string | null;
  debtor_code: string | null;
  debtor_name: string | null;
  branch_location: string | null;
  warehouse_id: string | null;
  warehouse_code: string | null;
  warehouse_name: string | null;
  item_count: number;
  line_total_qty: number;
  status: string;
  items: Array<{
    id: string;
    item_code: string;
    description: string | null;
    qty: number;
    item_group: string | null;
    uom: string | null;
  }>;
};

const buildCorColumns = (): DataGridColumn<CorRow>[] => [
  {
    key: 'note_number', label: 'Note No.', width: 150, sortable: true,
    accessor: (g) => <span className={styles.codeChip}>{g.note_number}</span>,
    searchValue: (g) => g.note_number,
    sortFn: (a, b) => a.note_number.localeCompare(b.note_number),
  },
  {
    key: 'note_date', label: 'Note Date', width: 120, sortable: true,
    accessor: (g) => (g.note_date ?? '').slice(0, 10) || '—',
    searchValue: (g) => g.note_date ?? '',
    sortFn: (a, b) => String(a.note_date ?? '').localeCompare(String(b.note_date ?? '')),
  },
  {
    key: 'parent_doc_no', label: 'Consignment #', width: 150, sortable: true, groupable: true,
    accessor: (g) => <span className={styles.codeChip}>{g.parent_doc_no ?? '—'}</span>,
    searchValue: (g) => g.parent_doc_no ?? '',
    groupValue: (g) => g.parent_doc_no ?? '(none)',
    sortFn: (a, b) => (a.parent_doc_no ?? '').localeCompare(b.parent_doc_no ?? ''),
  },
  {
    key: 'debtor_name', label: 'Debtor', width: 240, sortable: true, groupable: true,
    accessor: (g) => g.debtor_name ?? '—',
    searchValue: (g) => `${g.debtor_code ?? ''} ${g.debtor_name ?? ''}`.trim(),
    groupValue: (g) => g.debtor_name ?? '(none)',
  },
  {
    key: 'branch_location', label: 'Branch', width: 180, sortable: true, groupable: true, defaultHidden: true,
    accessor: (g) => g.branch_location ?? '—',
    searchValue: (g) => g.branch_location ?? '',
    groupValue: (g) => g.branch_location ?? '(none)',
  },
  {
    key: 'warehouse_code', label: 'Warehouse', width: 140, sortable: true, groupable: true,
    accessor: (g) => g.warehouse_code ? `${g.warehouse_code} — ${g.warehouse_name ?? ''}`.trim().replace(/—\s*$/, '') : '—',
    searchValue: (g) => `${g.warehouse_code ?? ''} ${g.warehouse_name ?? ''}`.trim(),
    groupValue: (g) => g.warehouse_code ?? '(none)',
  },
  {
    key: 'item_count', label: 'Item Count', width: 110, sortable: true, align: 'right',
    accessor: (g) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{g.item_count}</span>,
    searchValue: (g) => String(g.item_count),
    sortFn: (a, b) => a.item_count - b.item_count,
  },
  {
    key: 'line_total_qty', label: 'Total Qty', width: 110, sortable: true, align: 'right',
    accessor: (g) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{g.line_total_qty}</span>,
    searchValue: (g) => String(g.line_total_qty),
    sortFn: (a, b) => a.line_total_qty - b.line_total_qty,
  },
  {
    key: 'status', label: 'Status', width: 120, sortable: true, groupable: true,
    accessor: (g) => (
      <span className={styles.statusPill} style={{ background: STATUS_COLOR[g.status] ?? STATUS_COLOR.DRAFT }}>
        {STATUS_LABEL[g.status] ?? g.status}
      </span>
    ),
    searchValue: (g) => STATUS_LABEL[g.status] ?? g.status,
    groupValue: (g) => STATUS_LABEL[g.status] ?? g.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
];

/* ── L2 expansion — per-note line items table (mirrors ExpandedDoLines) ─── */
const TH_BASE: CSSProperties = { padding: '2px 8px', textAlign: 'left' };
const TH_RIGHT: CSSProperties = { ...TH_BASE, textAlign: 'right' };
const TD_BASE: CSSProperties = { padding: '3px 8px', verticalAlign: 'top' };
const TD_RIGHT: CSSProperties = { ...TD_BASE, textAlign: 'right' };

const ExpandedCorLines = ({ row }: { row: CorRow }) => {
  /* Items are nested on the list payload — render directly. No extra fetch
     needed for a typical RETURN note (1-20 lines). */
  const items = row.items ?? [];
  if (items.length === 0) {
    return <div style={{ padding: '8px 12px', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>No line items.</div>;
  }
  return (
    <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-2) 40px', background: 'var(--c-cream)' }}>
      <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{
          width: 720, minWidth: 520, borderCollapse: 'collapse',
          fontSize: 'var(--fs-11)', fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)', tableLayout: 'fixed',
        }}>
          <thead>
            <tr style={{
              color: 'var(--fg-muted)', fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)',
              letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid rgba(34, 31, 32, 0.10)',
            }}>
              <th style={{ ...TH_BASE, width: 100 }}>Group</th>
              <th style={{ ...TH_BASE, width: 140 }}>Item Code</th>
              <th style={{ ...TH_BASE, width: 320 }}>Description</th>
              <th style={{ ...TH_BASE, width: 60 }}>UOM</th>
              <th style={{ ...TH_RIGHT, width: 80 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} style={{ borderTop: '1px solid rgba(34, 31, 32, 0.05)' }}>
                <td style={TD_BASE}>{it.item_group ?? '—'}</td>
                <td style={{ ...TD_BASE, fontWeight: 700, color: 'var(--c-burnt)' }}>{it.item_code ?? '—'}</td>
                <td style={TD_BASE}>{it.description ?? '—'}</td>
                <td style={TD_BASE}>{it.uom || 'UNIT'}</td>
                <td style={TD_RIGHT}>{it.qty ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const ConsignmentReturnsList = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useConsignmentReturns();

  const rows = useMemo<CorRow[]>(() => (data?.notes ?? []) as CorRow[], [data]);
  const columns = useMemo(() => buildCorColumns(), []);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Consignment Returns</h1>
          <p className={styles.subtitle}>RETURN notes pulled back from debtor branches — double-click to open the parent CO</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="md" onClick={() => navigate('/consignment')}>
            <ArrowRightLeft {...ICON} />
            <span>Go to Consignment</span>
          </Button>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading consignment returns…' : `${rows.length} return notes`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load Consignment Returns.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid<CorRow>
        rows={rows}
        columns={columns}
        storageKey={COR_LIST_STORAGE_KEY}
        rowKey={(g) => g.id}
        searchPlaceholder="Search COR notes…"
        onRowDoubleClick={(g) => navigate(`/consignment/${g.parent_id}`)}
        expandable={{
          renderExpansion: (row) => <ExpandedCorLines row={row} />,
          rowExpansionKey: (row) => row.id,
        }}
        contextMenu={(g) => [
          { label: 'View parent consignment', onClick: () => navigate(`/consignment/${g.parent_id}`) },
        ]}
        isLoading={isLoading}
        emptyMessage="No consignment returns yet — RETURN notes are created from the parent CO detail page."
      />
    </div>
  );
};
