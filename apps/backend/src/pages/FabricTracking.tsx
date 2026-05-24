// ----------------------------------------------------------------------------
// Fabric Tracking — fabric inventory snapshot + per-context price tiers.
//
// Ported (simplified) from HOOKKA src/pages/inventory/fabrics.tsx. Reads the
// static fabric_trackings table — metrics (SOH, usage, shortage) are the seed
// snapshot, not live-aggregated. The tier picker writes through to the API
// (PATCH /fabric-tracking/:id/tier).
//
// 2990s design tokens throughout: cream canvas, Merriweather title, Raleway
// eyebrows, Lucide stroke 1.75, no Tailwind, exactly one orange accent
// signature (the tier picker pill — it has to stand out).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Layers, Package, Search } from 'lucide-react';
import {
  useFabricTrackings,
  useUpdateFabricTier,
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

const catClass = (c: FabricCategoryValue | null): string => {
  // Cast each lookup to string — CSS Modules typings declare each export
  // as `string | undefined`, which trips strict mode even though these
  // classes always resolve at build time.
  if (c === 'B.M-FABR') return styles.catBM as string;
  if (c === 'S-FABR') return styles.catS as string;
  if (c === 'S.M-FABR') return styles.catSM as string;
  if (c === 'LINING') return styles.catLN as string;
  if (c === 'WEBBING') return styles.catWB as string;
  return '';
};

const fmtMeters = (centi: number): string =>
  centi === 0 ? '0' : (centi / 100).toLocaleString('en-MY', { maximumFractionDigits: 2 });

const fmtPrice = (centi: number): string =>
  centi === 0
    ? 'RM 0.00'
    : `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const FabricTracking = () => {
  const [category, setCategory] = useState<'all' | FabricCategoryValue>('all');
  const [search, setSearch] = useState('');

  const { data: fabrics, isLoading, error } = useFabricTrackings({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => fabrics ?? [], [fabrics]);

  const totalSohMeters = useMemo(
    () => rows.reduce((sum, r) => sum + r.soh_centi, 0) / 100,
    [rows],
  );

  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Fabric Tracking</h1>
        <p className={styles.subtitle}>Material inventory matching Google Sheet "Fabric" tab</p>
      </div>

      <div className={styles.statGrid}>
        <StatCard
          icon={<Layers size={24} strokeWidth={1.75} />}
          label="Total Fabrics"
          value={isLoading ? '—' : rows.length.toString()}
        />
        <StatCard
          icon={<Package size={24} strokeWidth={1.75} />}
          label="Total SOH"
          value={
            isLoading
              ? '—'
              : `${totalSohMeters.toLocaleString('en-MY', { maximumFractionDigits: 2 })} m`
          }
        />
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
              <th>Category</th>
              <th>Sofa Tier</th>
              <th>Bedframe Tier</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th style={{ textAlign: 'right' }}>SOH</th>
              <th style={{ textAlign: 'right' }}>PO Outstanding</th>
              <th style={{ textAlign: 'right' }}>Last 30d Used</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className={styles.emptyRow}>Loading fabrics…</td>
              </tr>
            )}
            {!isLoading && rows.map((row) => <FabricRow key={row.id} row={row} />)}
            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={9} className={styles.emptyRow}>
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

const StatCard = ({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <div className={styles.statCard}>
    <span className={styles.statIcon}>{icon}</span>
    <div className={styles.statBody}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  </div>
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
      <td>
        {row.fabric_category && (
          <span className={`${styles.catChip} ${catClass(row.fabric_category)}`}>
            {row.fabric_category}
          </span>
        )}
      </td>
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
      <td className={row.price_centi ? styles.price : styles.priceEmpty}>
        {fmtPrice(row.price_centi)}
      </td>
      <td className={styles.numCell}>{fmtMeters(row.soh_centi)}</td>
      <td className={styles.numCellMuted}>
        {row.po_outstanding_centi === 0 ? '—' : fmtMeters(row.po_outstanding_centi)}
      </td>
      <td className={styles.numCellMuted}>
        {row.one_month_usage_centi === 0 ? '—' : fmtMeters(row.one_month_usage_centi)}
      </td>
    </tr>
  );
};
