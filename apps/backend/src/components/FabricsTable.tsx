// ----------------------------------------------------------------------------
// FabricsTable — shared 5-column fabrics editor.
//
// Used by:
//   1. /fabric-tracking standalone page
//   2. Products → Maintenance → Fabrics sub-tab
//
// Columns: Fabric Code · Description · Supplier Code (editable) · Sofa Tier
// (cycle PRICE_1/2/3 on click) · Bedframe Tier (cycle on click).
//
// DataGrid conversion (owner request 2026-06-12): the plain <table> is now
// the shared DataGrid (sort / per-column filter / column show-hide /
// reorder / persisted layout). The click-to-edit cells (Series /
// Description / Supplier Code), tier cycle buttons and per-row delete are
// self-contained components and ride inside the column accessors unchanged.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import {
  useUpdateFabricTier,
  useUpdateFabricSupplierCode,
  useUpdateFabricDescription,
  useUpdateFabricSeries,
  useDeleteFabric,
  type FabricTier,
  type FabricTierField,
  type FabricTrackingRow,
} from '../lib/fabric-queries';
import { DataGrid, type DataGridColumn } from './DataGrid';
import styles from '../pages/FabricTracking.module.css';

/* Commander 2026-05-27 (Fix 6): only Price 1 and Price 2 in use today.
   Cycle collapses to a 2-state toggle; PRICE_3 in the schema stays so
   historical rows still render, but new clicks never produce a PRICE_3.
   When a legacy PRICE_3 row IS encountered we cycle it forward to PRICE_1
   on the next click so commander can clean those up by tapping through. */
const TIER_NEXT: Record<FabricTier, FabricTier> = {
  PRICE_1: 'PRICE_2',
  PRICE_2: 'PRICE_1',
  PRICE_3: 'PRICE_1',
};

const tierShort = (t: FabricTier | null): string =>
  t ? `Price ${t.replace('PRICE_', '')}` : '—';

/* Tier cycle button — hooks live in a real component (NOT a column accessor
   closure) so the rules of hooks hold inside the DataGrid render. */
const TierCell = ({ row, field, tier }: {
  row: FabricTrackingRow; field: FabricTierField; tier: FabricTier | null;
}) => {
  const updateTier = useUpdateFabricTier();
  return (
    <button
      type="button"
      className={styles.tierPicker}
      onClick={() => updateTier.mutate({ id: row.id, field, tier: TIER_NEXT[tier ?? 'PRICE_2'] })}
      title="Click to cycle PRICE_1 → 2 → 3"
    >
      {tierShort(tier)}
    </button>
  );
};

const DeleteCell = ({ row }: { row: FabricTrackingRow }) => {
  const deleteFabric = useDeleteFabric();
  return (
    <button
      type="button"
      className={styles.iconBtn}
      onClick={() => {
        if (confirm(`Delete fabric ${row.fabric_code}? This cannot be undone.`)) {
          deleteFabric.mutate(row.id);
        }
      }}
      title="Delete fabric"
      style={{ color: 'var(--c-festive-b, #B8331F)' }}
      disabled={deleteFabric.isPending}
    >
      <Trash2 size={14} strokeWidth={1.75} />
    </button>
  );
};

/* Column spec lives at module scope — accessors only render self-contained
   cell components, so the array is stable and the DataGrid memo hits. */
const sofaTier = (r: FabricTrackingRow): FabricTier | null => r.sofa_price_tier ?? r.price_tier;
const bedTier = (r: FabricTrackingRow): FabricTier | null => r.bedframe_price_tier ?? r.price_tier;

const FABRIC_COLUMNS: DataGridColumn<FabricTrackingRow>[] = [
  {
    key: 'code',
    label: 'Fabric Code',
    width: 150,
    accessor: (r) => <span className={styles.codeChip}>{r.fabric_code}</span>,
    searchValue: (r) => r.fabric_code,
    filterValue: (r) => r.fabric_code,
    sortFn: (a, b) => a.fabric_code.localeCompare(b.fabric_code),
  },
  {
    key: 'series',
    label: 'Series',
    width: 180,
    accessor: (r) => <SeriesCell id={r.id} value={r.series ?? ''} />,
    searchValue: (r) => r.series ?? '',
    filterValue: (r) => r.series ?? '',
    sortFn: (a, b) => (a.series ?? '').localeCompare(b.series ?? ''),
  },
  {
    key: 'description',
    label: 'Description',
    width: 240,
    accessor: (r) => <DescriptionCell id={r.id} value={r.fabric_description ?? ''} />,
    searchValue: (r) => r.fabric_description ?? '',
    filterValue: (r) => r.fabric_description ?? '',
    sortFn: (a, b) => (a.fabric_description ?? '').localeCompare(b.fabric_description ?? ''),
  },
  {
    key: 'supplierCode',
    label: 'Supplier Code',
    width: 160,
    accessor: (r) => <SupplierCodeCell id={r.id} value={r.supplier_code ?? ''} />,
    searchValue: (r) => r.supplier_code ?? '',
    filterValue: (r) => r.supplier_code ?? '',
    sortFn: (a, b) => (a.supplier_code ?? '').localeCompare(b.supplier_code ?? ''),
  },
  {
    key: 'sofaTier',
    label: 'Sofa Tier',
    width: 110,
    accessor: (r) => <TierCell row={r} field="sofaPriceTier" tier={sofaTier(r)} />,
    searchValue: (r) => tierShort(sofaTier(r)),
    filterValue: (r) => tierShort(sofaTier(r)),
    sortFn: (a, b) => tierShort(sofaTier(a)).localeCompare(tierShort(sofaTier(b))),
  },
  {
    key: 'bedframeTier',
    label: 'Bedframe Tier',
    width: 110,
    accessor: (r) => <TierCell row={r} field="bedframePriceTier" tier={bedTier(r)} />,
    searchValue: (r) => tierShort(bedTier(r)),
    filterValue: (r) => tierShort(bedTier(r)),
    sortFn: (a, b) => tierShort(bedTier(a)).localeCompare(tierShort(bedTier(b))),
  },
  {
    key: 'actions',
    label: '',
    width: 48,
    minWidth: 48,
    align: 'right',
    sortable: false,
    groupable: false,
    accessor: (r) => <DeleteCell row={r} />,
    searchValue: () => '',
  },
];

export const FabricsTable = ({
  rows,
  isLoading,
  error,
}: {
  rows: FabricTrackingRow[];
  isLoading: boolean;
  error: unknown;
  /** Legacy "N of N records" header toggle — the DataGrid's own status line
      now shows the row count, so this prop is accepted but unused. */
  showHeader?: boolean;
}) => (
  <>
    {error && !isLoading && (
      <div className={styles.bannerWarn}>
        <strong>Failed to load fabrics.</strong>{' '}
        {error instanceof Error ? error.message : String(error)}
      </div>
    )}

    <DataGrid
      rows={rows}
      columns={FABRIC_COLUMNS}
      storageKey="dg-fabrics-converter"
      rowKey={(r) => r.id}
      searchPlaceholder="Filter visible fabrics…"
      groupBanner={false}
      isLoading={isLoading}
      emptyMessage='No fabrics yet — click "+ New Fabric" to add one.'
    />
  </>
);

const SupplierCodeCell = ({ id, value }: { id: string; value: string }) => {
  const update = useUpdateFabricSupplierCode();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id, supplierCode: trimmed.length ? trimmed : null },
      { onSettled: () => setEditing(false) },
    );
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={value ? styles.supplierCodeChip : styles.supplierCodeEmpty}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit the supplier's own code"
      >
        {value || '+ Add'}
      </button>
    );
  }

  return (
    <span className={styles.supplierCodeEditor}>
      <input
        autoFocus
        className={styles.supplierCodeInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        onBlur={commit}
      />
      <button type="button" className={styles.iconBtn} onMouseDown={(e) => e.preventDefault()} onClick={commit} title="Save">
        <Check size={14} strokeWidth={1.75} />
      </button>
      <button type="button" className={styles.iconBtn} onMouseDown={(e) => e.preventDefault()} onClick={cancel} title="Cancel">
        <X size={14} strokeWidth={1.75} />
      </button>
    </span>
  );
};

/* PR #38 — Click-to-edit Description cell. Same UX as SupplierCodeCell. */
const DescriptionCell = ({ id, value }: { id: string; value: string }) => {
  const update = useUpdateFabricDescription();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    update.mutate(
      { id, description: trimmed.length ? trimmed : null },
      { onSettled: () => setEditing(false) },
    );
  };

  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) {
    return (
      <button
        type="button"
        className={value ? styles.supplierCodeChip : styles.supplierCodeEmpty}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit description"
        style={{ width: '100%', textAlign: 'left' }}
      >
        {value || '+ Add description'}
      </button>
    );
  }

  return (
    <span className={styles.supplierCodeEditor}>
      <input
        autoFocus
        className={styles.supplierCodeInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        onBlur={commit}
        style={{ minWidth: 220 }}
      />
      <button type="button" className={styles.iconBtn} onMouseDown={(e) => e.preventDefault()} onClick={commit} title="Save">
        <Check size={14} strokeWidth={1.75} />
      </button>
      <button type="button" className={styles.iconBtn} onMouseDown={(e) => e.preventDefault()} onClick={cancel} title="Cancel">
        <X size={14} strokeWidth={1.75} />
      </button>
    </span>
  );
};

/* Migration 0063 — Click-to-edit Series cell. Same UX as Description /
   Supplier Code. Click chip → input → Enter saves, Esc cancels, blur saves. */
const SeriesCell = ({ id, value }: { id: string; value: string }) => {
  const update = useUpdateFabricSeries();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) { setEditing(false); return; }
    update.mutate(
      { id, series: trimmed.length ? trimmed : null },
      { onSettled: () => setEditing(false) },
    );
  };

  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) {
    return (
      <button
        type="button"
        className={value ? styles.supplierCodeChip : styles.supplierCodeEmpty}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit series"
        style={{ width: '100%', textAlign: 'left' }}
      >
        {value || '+ Add series'}
      </button>
    );
  }

  return (
    <span className={styles.supplierCodeEditor}>
      <input
        autoFocus
        className={styles.supplierCodeInput}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
        onBlur={commit}
        style={{ minWidth: 180 }}
      />
      <button type="button" className={styles.iconBtn} onMouseDown={(e) => e.preventDefault()} onClick={commit} title="Save">
        <Check size={14} strokeWidth={1.75} />
      </button>
      <button type="button" className={styles.iconBtn} onMouseDown={(e) => e.preventDefault()} onClick={cancel} title="Cancel">
        <X size={14} strokeWidth={1.75} />
      </button>
    </span>
  );
};
