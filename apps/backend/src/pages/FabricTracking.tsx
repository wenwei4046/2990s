// ----------------------------------------------------------------------------
// Fabric Tracking — minimal view.
//
// Commander's call (2026-05-24): drop the stat cards + Category / Price / SOH
// / PO Outstanding / 30-day Usage columns. The fabric master only needs:
//   1. Fabric Code        — our internal code
//   2. Description        — what it is
//   3. Supplier Code      — what the supplier calls it (printed on POs)
//   4. Sofa Tier          — drives sofa price selection
//   5. Bedframe Tier      — drives bedframe price selection
//
// Supplier code is inline-editable. Tier columns cycle PRICE_1 → 2 → 3 on
// click. The legacy `category` field stays in the schema for filtering only —
// not shown in the table.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Layers, Search, Check, X } from 'lucide-react';
import {
  useFabricTrackings,
  useUpdateFabricTier,
  useUpdateFabricSupplierCode,
  type FabricCategoryValue,
  type FabricTier,
  type FabricTierField,
  type FabricTrackingRow,
} from '../lib/fabric-queries';
import styles from './FabricTracking.module.css';

const CATEGORY_OPTIONS: { value: 'all' | FabricCategoryValue; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'B.M-FABR', label: 'B.M-FABR · Bedframe Main' },
  { value: 'S-FABR', label: 'S-FABR · Secondary' },
  { value: 'S.M-FABR', label: 'S.M-FABR · Sofa Main' },
  { value: 'LINING', label: 'LINING' },
  { value: 'WEBBING', label: 'WEBBING' },
];

const TIER_NEXT: Record<FabricTier, FabricTier> = {
  PRICE_1: 'PRICE_2',
  PRICE_2: 'PRICE_3',
  PRICE_3: 'PRICE_1',
};

const tierShort = (t: FabricTier | null): string =>
  t ? `Price ${t.replace('PRICE_', '')}` : '—';

export const FabricTracking = () => {
  const [category, setCategory] = useState<'all' | FabricCategoryValue>('all');
  const [search, setSearch] = useState('');

  const { data: fabrics, isLoading, error } = useFabricTrackings({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => fabrics ?? [], [fabrics]);

  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Fabric Tracking</h1>
        <p className={styles.subtitle}>Fabric master — drives sofa + bedframe pricing tier and the supplier code printed on POs.</p>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Search size={16} strokeWidth={1.75} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by code or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={styles.categorySelect}
          value={category}
          onChange={(e) => setCategory(e.target.value as 'all' | FabricCategoryValue)}
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load fabrics.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
            If <code>fabric_trackings</code> isn't migrated yet, run
            <code> 0039_hookka_products_port.sql</code> + the seed against Supabase.
          </span>
        </div>
      )}

      <div className={styles.tableCard}>
        <div className={styles.recordCount}>
          {isLoading ? 'Loading…' : `${rows.length} of ${rows.length} records`}
        </div>
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
    </div>
  );
};

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

/* Inline editor for the supplier_code field. Click the cell → text input;
   Enter or blur commits via PATCH, Escape cancels. */
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
