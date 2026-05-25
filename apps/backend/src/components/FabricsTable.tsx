// ----------------------------------------------------------------------------
// FabricsTable — shared 5-column fabrics editor.
//
// Used by:
//   1. /fabric-tracking standalone page
//   2. Products → Maintenance → Fabrics sub-tab
//
// Columns: Fabric Code · Description · Supplier Code (editable) · Sofa Tier
// (cycle PRICE_1/2/3 on click) · Bedframe Tier (cycle on click).
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Layers, Check, X } from 'lucide-react';
import {
  useUpdateFabricTier,
  useUpdateFabricSupplierCode,
  type FabricTier,
  type FabricTierField,
  type FabricTrackingRow,
} from '../lib/fabric-queries';
import styles from '../pages/FabricTracking.module.css';

const TIER_NEXT: Record<FabricTier, FabricTier> = {
  PRICE_1: 'PRICE_2',
  PRICE_2: 'PRICE_3',
  PRICE_3: 'PRICE_1',
};

const tierShort = (t: FabricTier | null): string =>
  t ? `Price ${t.replace('PRICE_', '')}` : '—';

export const FabricsTable = ({
  rows,
  isLoading,
  error,
  showHeader = true,
}: {
  rows: FabricTrackingRow[];
  isLoading: boolean;
  error: unknown;
  /** Show the "N of N records" header — set false when embedding inside a
      card that already has its own header (e.g. Maintenance panel). */
  showHeader?: boolean;
}) => (
  <>
    {error && !isLoading && (
      <div className={styles.bannerWarn}>
        <strong>Failed to load fabrics.</strong>{' '}
        {error instanceof Error ? error.message : String(error)}
      </div>
    )}

    <div className={styles.tableCard}>
      {showHeader && (
        <div className={styles.recordCount}>
          {isLoading ? 'Loading…' : `${rows.length} of ${rows.length} records`}
        </div>
      )}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Fabric Code</th>
            <th>Description</th>
            <th>Supplier Code</th>
            <th>Sofa Tier</th>
            <th>Bedframe Tier</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr>
              <td colSpan={5} className={styles.emptyRow}>Loading fabrics…</td>
            </tr>
          )}
          {!isLoading && rows.map((row) => <FabricRow key={row.id} row={row} />)}
          {!isLoading && !error && rows.length === 0 && (
            <tr>
              <td colSpan={5} className={styles.emptyRow}>
                <Layers size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No fabrics yet.</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </>
);

const FabricRow = ({ row }: { row: FabricTrackingRow }) => {
  const updateTier = useUpdateFabricTier();

  const cycleTier = (field: FabricTierField, current: FabricTier | null) => {
    const next = TIER_NEXT[current ?? 'PRICE_2'];
    updateTier.mutate({ id: row.id, field, tier: next });
  };

  return (
    <tr>
      <td><span className={styles.codeChip}>{row.fabric_code}</span></td>
      <td>{row.fabric_description ?? '—'}</td>
      <td><SupplierCodeCell id={row.id} value={row.supplier_code ?? ''} /></td>
      <td>
        <button
          type="button"
          className={styles.tierPicker}
          onClick={() => cycleTier('sofaPriceTier', row.sofa_price_tier ?? row.price_tier)}
          title="Click to cycle PRICE_1 → 2 → 3"
        >
          {tierShort(row.sofa_price_tier ?? row.price_tier)}
        </button>
      </td>
      <td>
        <button
          type="button"
          className={styles.tierPicker}
          onClick={() => cycleTier('bedframePriceTier', row.bedframe_price_tier ?? row.price_tier)}
          title="Click to cycle PRICE_1 → 2 → 3"
        >
          {tierShort(row.bedframe_price_tier ?? row.price_tier)}
        </button>
      </td>
    </tr>
  );
};

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
