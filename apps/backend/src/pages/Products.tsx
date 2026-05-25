// ----------------------------------------------------------------------------
// Products & Maintenance — manufacturer SKU master + variant config editor.
//
// Ported from HOOKKA src/pages/products/index.tsx (~2839 LOC). 2990s
// version uses the existing design tokens (PORT_DESIGN.md §2 + UI_REFERENCE
// non-negotiables in CLAUDE.md):
//   - cream canvas (--c-cream), paper card (--c-paper)
//   - Merriweather title, Poppins body, Raleway eyebrow + caps tracking-loud
//   - Archivo Black for the price column (--font-mark, 80% stretch, burnt)
//   - Lucide icons stroke 1.75, no emoji
//   - exactly ONE primary orange CTA per screen (Edit Prices / Save)
//   - rounded-only tokens (no literal px on border-radius)
//
// Tabs:
//   [SKU Master] — list of mfg_products, filterable by category, with the
//       Edit Prices / Export / Import actions in the top-right.
//   [Maintenance] — left-rail of sub-tabs grouped Bedframe / Sofa / Common,
//       right-panel list editor for the focused sub-tab. Save opens an
//       effective-date drawer.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  Download,
  Upload,
  Edit3,
  Search,
  Settings2,
  History,
  Package,
  Trash2,
  Plus,
  X,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useMfgProducts,
  useUpdateMfgProductPrices,
  useMfgProductPriceHistory,
  useCreateMfgProduct,
  useMaintenanceConfig,
  useMaintenanceConfigHistory,
  useSaveMaintenanceConfig,
  type MfgCategory,
  type MfgProductRow,
  type MaintenanceConfig,
  type PricedOption,
  type SeatHeightPrice,
  type SofaPriceTier,
} from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import { FabricsTable } from '../components/FabricsTable';
import styles from './Products.module.css';

const ICON_PROPS = { size: 16, strokeWidth: 1.75 } as const;

type TopTab = 'sku' | 'maintenance';

export const Products = () => {
  const [topTab, setTopTab] = useState<TopTab>('sku');

  return (
    <div className={styles.page}>
      <header className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Products</h1>
          <div className={styles.tabSwitch} role="tablist">
            <button
              type="button"
              role="tab"
              data-active={topTab === 'sku'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('sku')}
            >
              SKU Master
            </button>
            <button
              type="button"
              role="tab"
              data-active={topTab === 'maintenance'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('maintenance')}
            >
              Maintenance
            </button>
          </div>
        </div>
      </header>

      {topTab === 'sku' ? <SkuMasterTab /> : <MaintenanceTab />}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   SKU Master tab
   ════════════════════════════════════════════════════════════════════════ */

const CATEGORIES: { value: MfgCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'BEDFRAME', label: 'Bedframe' },
  { value: 'SOFA', label: 'Sofa' },
  { value: 'MATTRESS', label: 'Mattress' },
  { value: 'SERVICE', label: 'Service' },
];

const fmtRm = (sen: number | null): string => {
  if (sen == null) return '—';
  return `RM ${(sen / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtUnit = (milli: number): string =>
  (milli / 1000).toFixed(3);

type Tier = SofaPriceTier;

const TIER_CHIPS: { value: Tier; label: string }[] = [
  { value: 'PRICE_1', label: 'P1' },
  { value: 'PRICE_2', label: 'P2' },
  { value: 'PRICE_3', label: 'P3' },
];

// Look up the priceSen for a given (height, tier) pair. Legacy rows with no
// `tier` field count as PRICE_2 (HOOKKA's historic default).
const priceForHeightTier = (
  arr: SeatHeightPrice[] | null | undefined,
  height: string,
  tier: Tier,
): number | null => {
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((p) => p.height === height && (p.tier ?? 'PRICE_2') === tier);
  return hit ? hit.priceSen : null;
};

// Replace (or insert) the priceSen for one (height × tier) slot in the array.
const upsertHeightTier = (
  arr: SeatHeightPrice[] | null | undefined,
  height: string,
  tier: Tier,
  priceSen: number | null,
): SeatHeightPrice[] => {
  const next = Array.isArray(arr) ? [...arr] : [];
  const idx = next.findIndex(
    (p) => p.height === height && (p.tier ?? 'PRICE_2') === tier,
  );
  if (priceSen == null || priceSen === 0) {
    if (idx >= 0) next.splice(idx, 1);
    return next;
  }
  const entry: SeatHeightPrice = { height, priceSen, tier };
  if (idx >= 0) next[idx] = entry;
  else next.push(entry);
  return next;
};

const SkuMasterTab = () => {
  const [category, setCategory] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [tier, setTier] = useState<Tier>('PRICE_2');

  const { data: products, isLoading, error } = useMfgProducts({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });
  const config = useMaintenanceConfig('master');

  const rows = useMemo(() => products ?? [], [products]);
  const isSofaView = category === 'SOFA';
  const isMattressView = category === 'MATTRESS';
  const sofaSizes = config.data?.data?.sofaSizes ?? ['24', '26', '28', '30', '32', '35'];

  // Drawer + modal state
  const [newSkuOpen, setNewSkuOpen] = useState(false);
  const [configureRow, setConfigureRow] = useState<MfgProductRow | null>(null);
  const [historyRow, setHistoryRow] = useState<MfgProductRow | null>(null);
  const [importing, setImporting] = useState(false);

  // Total column count (header colspan for loading/empty states):
  //   - Sofa: code + desc + model + N sizes + unit + variants
  //   - Mattress: code + desc + branding + size + price + unit  (no variants)
  //   - Other: code + desc + category + size + P2 + P1 + unit + variants
  const colCount = isSofaView
    ? 3 + sofaSizes.length + 1 + 1
    : isMattressView
      ? 6
      : 8;

  return (
    <>
      <div className={styles.headerRow}>
        <div className={styles.categoryChips}>
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c.value}
              active={category === c.value}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </CategoryChip>
          ))}
        </div>

        <div className={styles.actionsRow}>
          <div className={styles.searchBox}>
            <Search {...ICON_PROPS} className={styles.searchIcon} />
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search all products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="ghost" size="md" onClick={() => exportSkusCsv(rows)}>
            <Download {...ICON_PROPS} />
            <span>Export SKUs</span>
          </Button>
          <Button variant="ghost" size="md" onClick={() => setImporting(true)}>
            <Upload {...ICON_PROPS} />
            <span>Import SKUs</span>
          </Button>
          <Button variant="ghost" size="md" onClick={() => setNewSkuOpen(true)}>
            <Plus {...ICON_PROPS} />
            <span>New SKU</span>
          </Button>
          <Button
            variant={editMode ? 'secondary' : 'primary'}
            size="md"
            onClick={() => setEditMode(!editMode)}
          >
            <Edit3 {...ICON_PROPS} />
            <span>{editMode ? 'Cancel' : 'Edit Prices'}</span>
          </Button>
          {isSofaView && (
            <div className={styles.tierGroup}>
              <span className={styles.tierLabel}>TIER</span>
              <div className={styles.tierChips}>
                {TIER_CHIPS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTier(t.value)}
                    data-active={tier === t.value}
                    className={styles.tierChip}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading
          ? 'Loading products…'
          : `${rows.length} products · Production configs from SKU sheet`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load products.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
          <div style={{ marginTop: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            If this is a fresh deploy: run <code>pnpm db:push</code> + import
            <code> seeds/hookka-products-import.sql</code> against Supabase.
          </div>
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={`${styles.table} ${styles.tableCompact}`}>
          <thead>
            <tr>
              <th>Product Code</th>
              <th>Description</th>
              {isSofaView ? (
                <>
                  <th>Model</th>
                  {sofaSizes.map((s) => (
                    <th key={s} style={{ textAlign: 'right' }}>{s}</th>
                  ))}
                </>
              ) : isMattressView ? (
                <>
                  <th>Branding</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                </>
              ) : (
                <>
                  <th>Category</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right' }}>Price 2</th>
                  <th style={{ textAlign: 'right' }}>Price 1</th>
                </>
              )}
              <th style={{ textAlign: 'right' }}>Unit (m³)</th>
              {!isMattressView && <th>Variants</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-7)' }}>
                  Loading products…
                </td>
              </tr>
            )}
            {!isLoading && rows.map((row) => (
              <ProductRow
                key={row.id}
                row={row}
                editMode={editMode}
                isSofaView={isSofaView}
                isMattressView={isMattressView}
                sofaSizes={sofaSizes}
                tier={tier}
                onConfigure={setConfigureRow}
                onHistory={setHistoryRow}
              />
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-7)' }}>
                  <Package size={32} strokeWidth={1.5} />
                  <div style={{ marginTop: 8 }}>No products yet.</div>
                  <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                    Run the seed import if you just migrated the schema.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!isLoading && !error && (
          <div className={styles.tableFoot}>
            <span className={styles.eyebrow}>
              Record 1 of {rows.length}
            </span>
            <span className={styles.eyebrow}>{rows.length} total products</span>
          </div>
        )}
      </div>

      {newSkuOpen && <NewSkuDrawer onClose={() => setNewSkuOpen(false)} />}
      {configureRow && <ConfigureProductDrawer row={configureRow} onClose={() => setConfigureRow(null)} />}
      {historyRow && <PriceHistoryDialog row={historyRow} onClose={() => setHistoryRow(null)} />}
      {importing && <ImportSkusDialog onClose={() => setImporting(false)} />}
    </>
  );
};

const ProductRow = ({
  row, editMode, isSofaView, isMattressView, sofaSizes, tier, onConfigure, onHistory,
}: {
  row: MfgProductRow;
  editMode: boolean;
  isSofaView: boolean;
  isMattressView: boolean;
  sofaSizes: string[];
  tier: Tier;
  onConfigure?: (row: MfgProductRow) => void;
  onHistory?: (row: MfgProductRow) => void;
}) => {
  // Local draft of the seat_height_prices array — buffers user edits before
  // committing on blur. Reset whenever the row's data changes upstream.
  const [draftSeat, setDraftSeat] = useState<SeatHeightPrice[] | null>(null);
  const [draftBase, setDraftBase] = useState<number | null>(null);
  const [draftP1, setDraftP1] = useState<number | null>(null);
  const [draftBranding, setDraftBranding] = useState<string | null>(null);
  const update = useUpdateMfgProductPrices();

  // The effective array we read from — draft if mid-edit, else the server row.
  const seatArr = draftSeat ?? row.seat_height_prices ?? [];

  const updateSofaCell = (size: string, newPriceSen: number | null) => {
    const next = upsertHeightTier(seatArr, size, tier, newPriceSen);
    setDraftSeat(next);
    update.mutate({ id: row.id, seatHeightPrices: next });
  };

  const flushBedframePrice = (field: 'basePriceSen' | 'price1Sen', val: number | null) => {
    update.mutate({ id: row.id, [field]: val });
  };

  return (
    <tr className={styles.rowCompact}>
      <td><span className={styles.codeChip}>{row.code}</span></td>
      <td>
        <div className={styles.nameCompact}>{row.name}</div>
        {row.description && <div className={styles.nameSubCompact}>{row.description}</div>}
      </td>
      {isSofaView ? (
        <>
          <td className={styles.numCellMuted} style={{ textAlign: 'left' }}>
            {row.base_model ?? '—'}
          </td>
          {sofaSizes.map((s) => {
            const sen = priceForHeightTier(seatArr, s, tier);
            // When user is on P1 or P3 and the cell is empty, surface the P2
            // baseline as a placeholder so they have a reference price.
            const baselineSen = tier !== 'PRICE_2'
              ? priceForHeightTier(seatArr, s, 'PRICE_2')
              : null;
            return (
              <td key={s} className={sen ? styles.price : styles.priceEmpty}>
                {editMode ? (
                  <PriceInput
                    valueSen={sen}
                    baselineSen={baselineSen}
                    onCommit={(v) => updateSofaCell(s, v)}
                  />
                ) : (
                  fmtRm(sen)
                )}
              </td>
            );
          })}
        </>
      ) : isMattressView ? (
        <>
          {/* Branding cell — editable text input in edit mode. */}
          <td>
            {editMode ? (
              <BrandingInput
                value={draftBranding ?? row.branding ?? ''}
                onCommit={(v) => {
                  setDraftBranding(v);
                  update.mutate({ id: row.id, branding: v });
                }}
              />
            ) : (
              row.branding
                ? <span className={styles.catPill}>{row.branding}</span>
                : <span className={styles.priceEmpty}>—</span>
            )}
          </td>
          <td>{row.size_label ?? '—'}</td>
          {/* Single Price column for mattress — uses base_price_sen. */}
          <td className={(draftBase ?? row.base_price_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftBase ?? row.base_price_sen}
                onCommit={(v) => {
                  setDraftBase(v);
                  flushBedframePrice('basePriceSen', v);
                }}
              />
            ) : (
              fmtRm(row.base_price_sen)
            )}
          </td>
        </>
      ) : (
        <>
          <td><span className={styles.catPill}>{row.category}</span></td>
          <td>{row.size_label ?? '—'}</td>
          <td className={(draftBase ?? row.base_price_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftBase ?? row.base_price_sen}
                onCommit={(v) => {
                  setDraftBase(v);
                  flushBedframePrice('basePriceSen', v);
                }}
              />
            ) : (
              fmtRm(row.base_price_sen)
            )}
          </td>
          <td className={(draftP1 ?? row.price1_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftP1 ?? row.price1_sen}
                onCommit={(v) => {
                  setDraftP1(v);
                  flushBedframePrice('price1Sen', v);
                }}
              />
            ) : (
              fmtRm(row.price1_sen)
            )}
          </td>
        </>
      )}
      <td className={styles.numCell}>{fmtUnit(row.unit_m3_milli)}</td>
      {!isMattressView && (
        <td>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <Button variant="ghost" size="sm" disabled={editMode}
              onClick={() => onConfigure?.(row)}>
              <Settings2 {...ICON_PROPS} />
              <span>Configure</span>
            </Button>
            <Button variant="ghost" size="sm" disabled={editMode}
              onClick={() => onHistory?.(row)}
              title="Price history">
              <History {...ICON_PROPS} />
            </Button>
          </span>
        </td>
      )}
    </tr>
  );
};

/* Free-text branding input for Mattress rows. Commits on blur or Enter. */
const BrandingInput = ({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string | null) => void;
}) => {
  const [local, setLocal] = useState<string>(value);
  const commit = () => {
    const t = local.trim();
    if (t === value.trim()) return;
    onCommit(t.length ? t : null);
  };
  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="e.g. Sealy"
      style={{
        width: 140,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-13)',
        background: 'var(--c-cream)',
        border: '1px solid var(--c-orange)',
        borderRadius: 'var(--radius-sm)',
        padding: '3px 8px',
        outline: 'none',
      }}
    />
  );
};

/* Compact RM input — accepts blank (= clear). Commits on blur or Enter. */
const PriceInput = ({
  valueSen,
  onCommit,
  baselineSen,
}: {
  valueSen: number | null;
  onCommit: (v: number | null) => void;
  /** P2-tier baseline to surface as placeholder when P1/P3 cell is empty —
      shows what the default price would be so user knows the reference. */
  baselineSen?: number | null;
}) => {
  const [local, setLocal] = useState<string>(
    valueSen == null ? '' : (valueSen / 100).toFixed(2),
  );

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === '') {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onCommit(Math.round(parsed * 100));
  };

  const placeholder = baselineSen && baselineSen > 0
    ? `P2: ${(baselineSen / 100).toFixed(2)}`
    : undefined;

  return (
    <input
      type="number"
      step="0.01"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: 84,
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-13)',
        background: 'var(--c-cream)',
        border: '1px solid var(--c-orange)',
        borderRadius: 'var(--radius-sm)',
        padding: '3px 6px',
        outline: 'none',
      }}
    />
  );
};

const CategoryChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      fontFamily: 'var(--font-button)',
      fontSize: 'var(--fs-13)',
      fontWeight: 600,
      letterSpacing: '0.02em',
      padding: 'var(--space-2) var(--space-4)',
      borderRadius: 'var(--radius-pill)',
      border: active ? '1px solid var(--c-ink)' : '1px solid var(--line)',
      background: active ? 'var(--c-ink)' : 'var(--c-paper)',
      color: active ? 'var(--c-cream)' : 'var(--c-ink)',
      cursor: 'pointer',
      transition: 'all 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    }}
  >
    {children}
  </button>
);

/* ════════════════════════════════════════════════════════════════════════
   Maintenance tab
   ════════════════════════════════════════════════════════════════════════ */

type MaintenanceListKey =
  | 'divanHeights'
  | 'totalHeights'
  | 'gaps'
  | 'legHeights'
  | 'specials'
  | 'sofaSizes'
  | 'sofaLegHeights'
  | 'sofaSpecials'
  | 'fabrics';

const MAINTENANCE_TABS: {
  key: MaintenanceListKey;
  label: string;
  description: string;
  priced: boolean;
  section: 'Bedframe' | 'Sofa' | 'Common';
}[] = [
  { key: 'divanHeights', label: 'Divan Heights', description: 'Bedframe divan height options with surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'totalHeights', label: 'Total Heights', description: 'Total height (Divan + Gap + Leg) surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'gaps', label: 'Gaps', description: 'Bedframe gap height options (inches)', priced: false, section: 'Bedframe' },
  { key: 'legHeights', label: 'Leg Heights', description: 'Bedframe leg height options with surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'specials', label: 'Specials', description: 'Bedframe special order options with surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'sofaSizes', label: 'Sizes', description: 'Available sofa seat height sizes (inches)', priced: false, section: 'Sofa' },
  { key: 'sofaLegHeights', label: 'Leg Heights', description: 'Sofa leg height options with surcharge pricing', priced: true, section: 'Sofa' },
  { key: 'sofaSpecials', label: 'Specials', description: 'Sofa special order options with surcharge pricing', priced: true, section: 'Sofa' },
  { key: 'fabrics', label: 'Fabrics', description: 'Fabric price tier assignment — drives Price 1 / Price 2', priced: false, section: 'Common' },
];

const MaintenanceTab = () => {
  const resolved = useMaintenanceConfig('master');
  const history = useMaintenanceConfigHistory('master');
  const save = useSaveMaintenanceConfig();

  const [activeKey, setActiveKey] = useState<MaintenanceListKey>('divanHeights');
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<MaintenanceConfig | null>(null);
  const [showMaintHistory, setShowMaintHistory] = useState(false);

  // Count fabric_trackings rows for the left-rail "Fabrics (N)" badge.
  // Lightweight query (cached 30s) — uses the same hook as the panel itself.
  const fabricsList = useFabricTrackings();
  const fabricsCount = fabricsList.data?.length ?? 0;

  const config = draft ?? resolved.data?.data ?? null;
  const active = MAINTENANCE_TABS.find((t) => t.key === activeKey)!;

  const sections = ['Bedframe', 'Sofa', 'Common'] as const;

  const startEdit = () => {
    if (!resolved.data?.data) return;
    setDraft(JSON.parse(JSON.stringify(resolved.data.data)) as MaintenanceConfig);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditMode(false);
  };

  const handleSave = () => {
    if (!draft) return;
    const effectiveFrom = window.prompt('Effective from (YYYY-MM-DD)?', new Date().toISOString().slice(0, 10));
    if (!effectiveFrom) return;
    save.mutate(
      { scope: 'master', config: draft, effectiveFrom },
      {
        onSuccess: () => {
          setDraft(null);
          setEditMode(false);
        },
      },
    );
  };

  if (resolved.isLoading) {
    return <p className={styles.eyebrow}>Loading maintenance config…</p>;
  }

  if (resolved.isError) {
    return (
      <div className={styles.bannerWarn}>
        <strong>Failed to load maintenance config.</strong>{' '}
        {resolved.error instanceof Error ? resolved.error.message : String(resolved.error)}
        <div style={{ marginTop: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          The <code>maintenance_config_history</code> table likely doesn't exist
          yet. Run migration <code>0039_hookka_products_port.sql</code> against
          Supabase, then refresh.
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className={styles.bannerWarn}>
        No maintenance config baseline found. The migration ran but the master
        baseline row is missing — re-apply migration 0039 to seed it.
      </div>
    );
  }

  return (
    <div className={styles.maintLayout}>
      <aside className={styles.maintNav}>
        {sections.map((section) => (
          <div key={section}>
            <div className={styles.maintSection}>{section}</div>
            {MAINTENANCE_TABS.filter((t) => t.section === section).map((t) => {
              const count = t.key === 'fabrics' ? fabricsCount : countItems(config, t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  data-active={activeKey === t.key}
                  className={styles.maintNavItem}
                  onClick={() => setActiveKey(t.key)}
                >
                  <span>{t.label}</span>
                  <span className={styles.maintCount}>({count})</span>
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <section className={styles.maintPanel}>
        <header className={styles.maintHeader}>
          <div>
            <h2 className={styles.maintTitle}>{active.label}</h2>
            <p className={styles.maintSubtitle}>{active.description}</p>
            {resolved.data?.effectiveFrom && (
              <p className={styles.stateInfo} style={{ marginTop: 8 }}>
                Effective from {resolved.data.effectiveFrom}
                {resolved.data.hasPendingPriceChange && (
                  <span style={{ color: 'var(--c-burnt)', fontWeight: 600 }}>
                    · Pending change on {resolved.data.pendingEffectiveFrom}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className={styles.actionsRow}>
            {!editMode ? (
              <Button variant="ghost" size="sm" onClick={startEdit}>
                <Edit3 {...ICON_PROPS} />
                <span>Edit</span>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  <span>Cancel</span>
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={save.isPending}>
                  <span>{save.isPending ? 'Saving…' : 'Save'}</span>
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowMaintHistory(true)}>
              <History {...ICON_PROPS} />
              <span>History</span>
            </Button>
          </div>
        </header>

        <MaintenanceList
          listKey={active.key}
          config={config}
          editMode={editMode}
          onChange={(next) => setDraft(next)}
          priced={active.priced}
        />
      </section>

      {showMaintHistory && (
        <MaintenanceHistoryDialog
          activeLabel={active.label}
          activeKey={activeKey}
          history={history.data?.history ?? []}
          onClose={() => setShowMaintHistory(false)}
        />
      )}
    </div>
  );
};

const countItems = (cfg: MaintenanceConfig, key: MaintenanceListKey): number => {
  if (key === 'fabrics') return 0; // populated from fabric_trackings, not the JSON blob
  const v = cfg[key];
  return Array.isArray(v) ? v.length : 0;
};

const MaintenanceList = ({
  listKey,
  config,
  editMode,
  onChange,
  priced,
}: {
  listKey: MaintenanceListKey;
  config: MaintenanceConfig;
  editMode: boolean;
  onChange: (next: MaintenanceConfig) => void;
  priced: boolean;
}) => {
  // Empty draft state for the "add new" row at the bottom of the list when
  // edit mode is on. Kept local so toggling tabs cancels in-flight adds.
  const [draftValue, setDraftValue] = useState('');
  const [draftPrice, setDraftPrice] = useState('0.00');

  if (listKey === 'fabrics') {
    return <FabricsMaintenancePanel />;
  }

  // ── String[] tabs (gaps, sofaSizes) ───────────────────────────────────
  if (listKey === 'gaps' || listKey === 'sofaSizes') {
    const items = config[listKey] as string[];

    const removeAt = (idx: number) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      (next[listKey] as string[]).splice(idx, 1);
      onChange(next);
    };

    const addItem = () => {
      const v = draftValue.trim();
      if (!v) return;
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      (next[listKey] as string[]).push(v);
      onChange(next);
      setDraftValue('');
    };

    return (
      <div className={styles.maintList}>
        {items.map((v, i) => (
          <div key={`${v}-${i}`} className={styles.maintRow}>
            <button type="button" className={styles.maintRowIcon} title="History">
              <History {...ICON_PROPS} />
            </button>
            <span className={styles.maintRowIdx}>{i + 1}</span>
            <span className={styles.maintRowValue}>{v}</span>
            {editMode ? (
              <button
                type="button"
                className={styles.maintRowIcon}
                title="Remove"
                onClick={() => removeAt(i)}
                style={{ color: 'var(--c-festive-b, #B8331F)' }}
              >
                <Trash2 {...ICON_PROPS} />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}

        {editMode && (
          <div
            className={styles.maintRow}
            style={{
              background: 'var(--c-paper)',
              borderColor: 'var(--c-orange)',
              gridTemplateColumns: '32px 32px 1fr auto',
            }}
          >
            <span className={styles.maintRowIcon}><Plus {...ICON_PROPS} /></span>
            <span className={styles.maintRowIdx}>+</span>
            <input
              type="text"
              placeholder="New value (e.g. 28)"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-14)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <Button variant="primary" size="sm" onClick={addItem}>
              <Plus {...ICON_PROPS} />
              <span>Add</span>
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── PricedOption[] tabs (the rest) ────────────────────────────────────
  const items = config[listKey] as PricedOption[];

  const removeAt = (idx: number) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    (next[listKey] as PricedOption[]).splice(idx, 1);
    onChange(next);
  };

  const addItem = () => {
    const v = draftValue.trim();
    if (!v) return;
    const priceSen = Math.round((Number(draftPrice) || 0) * 100);
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    (next[listKey] as PricedOption[]).push({ value: v, priceSen });
    onChange(next);
    setDraftValue('');
    setDraftPrice('0.00');
  };

  return (
    <div className={styles.maintList}>
      {items.map((opt, i) => (
        <div key={`${opt.value}-${i}`} className={styles.maintRow}>
          <button type="button" className={styles.maintRowIcon} title="History">
            <History {...ICON_PROPS} />
          </button>
          <span className={styles.maintRowIdx}>{i + 1}</span>
          <span className={styles.maintRowValue}>
            {editMode ? (
              <input
                type="text"
                value={opt.value}
                onChange={(e) => {
                  const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
                  (next[listKey] as PricedOption[])[i]!.value = e.target.value;
                  onChange(next);
                }}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-16)',
                  fontWeight: 600,
                  background: 'var(--c-cream)',
                  border: '1px solid var(--c-orange)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  outline: 'none',
                  width: '100%',
                  maxWidth: 280,
                }}
              />
            ) : (
              opt.value
            )}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'flex-end' }}>
            <span className={styles.maintRowPrice}>
              <span className={styles.maintRowRmPrefix}>RM</span>
              {editMode ? (
                <input
                  type="number"
                  step="0.01"
                  value={(opt.priceSen / 100).toFixed(2)}
                  onChange={(e) => {
                    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
                    const list = next[listKey] as PricedOption[];
                    list[i]!.priceSen = Math.round(Number(e.target.value) * 100);
                    onChange(next);
                  }}
                  style={{
                    width: 90,
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-14)',
                    background: 'var(--c-cream)',
                    border: '1px solid var(--c-orange)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 8px',
                    outline: 'none',
                  }}
                />
              ) : (
                <span className={opt.priceSen === 0 ? styles.maintRowPriceMuted : undefined}>
                  {(opt.priceSen / 100).toFixed(2)}
                </span>
              )}
            </span>
            {editMode && (
              <button
                type="button"
                className={styles.maintRowIcon}
                title="Remove"
                onClick={() => removeAt(i)}
                style={{ color: 'var(--c-festive-b, #B8331F)' }}
              >
                <Trash2 {...ICON_PROPS} />
              </button>
            )}
          </span>
        </div>
      ))}

      {editMode && (
        <div
          className={styles.maintRow}
          style={{
            background: 'var(--c-paper)',
            borderColor: 'var(--c-orange)',
            gridTemplateColumns: '32px 32px 1fr auto',
          }}
        >
          <span className={styles.maintRowIcon}><Plus {...ICON_PROPS} /></span>
          <span className={styles.maintRowIdx}>+</span>
          <input
            type="text"
            placeholder="New value"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-14)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              outline: 'none',
            }}
          />
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span className={styles.maintRowRmPrefix}>RM</span>
            <input
              type="number"
              step="0.01"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              style={{
                width: 90,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-14)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                outline: 'none',
              }}
            />
            <Button variant="primary" size="sm" onClick={addItem}>
              <Plus {...ICON_PROPS} />
              <span>Add</span>
            </Button>
          </span>
        </div>
      )}

      {!priced && !editMode && <p className={styles.eyebrow}>No surcharge pricing for this list.</p>}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Fabrics sub-tab body — embeds the shared FabricsTable so the same editor
   shows up on /fabric-tracking and Products → Maintenance → Common → Fabrics.
   Has its own slim search bar so the 122-row list stays usable in-place.
   ════════════════════════════════════════════════════════════════════════ */

const FabricsMaintenancePanel = () => {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useFabricTrackings({
    search: search.trim() || undefined,
  });
  const rows = data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ position: 'relative', maxWidth: 360 }}>
        <Search
          {...ICON_PROPS}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code or description…"
          style={{
            width: '100%',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-14)',
            background: 'var(--c-paper)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-7)',
            color: 'var(--c-ink)',
            outline: 'none',
          }}
        />
      </div>
      <FabricsTable rows={rows} isLoading={isLoading} error={error} />
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   New SKU drawer — create a fresh mfg_product. Category drives which
   fields are shown (mattress hides Price 1, sofa shows Base Model, etc.).
   ════════════════════════════════════════════════════════════════════════ */

const NewSkuDrawer = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateMfgProduct();
  type Cat = 'BEDFRAME' | 'SOFA' | 'ACCESSORY' | 'MATTRESS' | 'SERVICE';
  const [form, setForm] = useState<{
    code: string; name: string; category: Cat;
    description: string; baseModel: string; sizeLabel: string;
    branding: string; fabricColor: string;
    basePrice: string; price1: string; costPrice: string;
    unitM3: string; productionTime: string;
  }>({
    code: '', name: '', category: 'BEDFRAME',
    description: '', baseModel: '', sizeLabel: '',
    branding: '', fabricColor: '',
    basePrice: '', price1: '', costPrice: '',
    unitM3: '', productionTime: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const isMattress = form.category === 'MATTRESS';
  const isSofa = form.category === 'SOFA';
  const isService = form.category === 'SERVICE';

  const submit = () => {
    if (!form.code.trim()) { alert('Code is required.'); return; }
    if (!form.name.trim()) { alert('Name is required.'); return; }
    const toSen = (s: string): number | null => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    };
    const toMilli = (s: string): number => {
      const t = s.trim();
      if (!t) return 0;
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n * 1000) : 0;
    };
    create.mutate({
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || undefined,
      baseModel: form.baseModel.trim() || undefined,
      sizeLabel: form.sizeLabel.trim() || undefined,
      branding: form.branding.trim() || undefined,
      fabricColor: form.fabricColor.trim() || undefined,
      basePriceSen: toSen(form.basePrice),
      price1Sen: isMattress || isService ? null : toSen(form.price1),
      costPriceSen: toSen(form.costPrice) ?? 0,
      unitM3Milli: toMilli(form.unitM3),
      productionTimeMinutes: Number(form.productionTime || 0) || 0,
    }, { onSuccess: onClose });
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New SKU</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Code *" value={form.code} onChange={(v) => set('code', v)} />
            <Field label="Name *" value={form.name} onChange={(v) => set('name', v)} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Category *</span>
              <select className={styles.fieldSelect} value={form.category}
                onChange={(e) => set('category', e.target.value as Cat)}>
                <option value="BEDFRAME">Bedframe</option>
                <option value="SOFA">Sofa</option>
                <option value="MATTRESS">Mattress</option>
                <option value="ACCESSORY">Accessory</option>
                <option value="SERVICE">Service</option>
              </select>
            </label>
            <Field label="Size Label" value={form.sizeLabel} onChange={(v) => set('sizeLabel', v)} />
            {isSofa && <Field label="Base Model" value={form.baseModel} onChange={(v) => set('baseModel', v)} />}
            {isMattress && <Field label="Branding" value={form.branding} onChange={(v) => set('branding', v)} placeholder="e.g. Sealy" />}
            {isSofa && <Field label="Fabric Color" value={form.fabricColor} onChange={(v) => set('fabricColor', v)} />}
            <Field label="Description" value={form.description} onChange={(v) => set('description', v)} fullWidth />

            <Field label={isMattress ? 'Price (RM)' : 'Base Price / Price 2 (RM)'}
              value={form.basePrice} onChange={(v) => set('basePrice', v)} type="number" />
            {!isMattress && !isService && (
              <Field label="Price 1 (RM)" value={form.price1} onChange={(v) => set('price1', v)} type="number" />
            )}
            <Field label="Cost Price (RM)" value={form.costPrice} onChange={(v) => set('costPrice', v)} type="number" />
            <Field label="Unit (m³)" value={form.unitM3} onChange={(v) => set('unitM3', v)} type="number" step="0.001" />
            {!isService && (
              <Field label="Production Time (min)" value={form.productionTime} onChange={(v) => set('productionTime', v)} type="number" />
            )}
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create SKU'}
          </Button>
        </footer>
      </aside>
    </div>
  );
};

const Field = ({
  label, value, onChange, type, step, placeholder, fullWidth,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  type?: string; step?: string; placeholder?: string;
  fullWidth?: boolean;
}) => (
  <label className={`${styles.field} ${fullWidth ? styles.formGridFull : ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    <input
      type={type ?? 'text'}
      step={step}
      placeholder={placeholder}
      className={styles.fieldInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

/* ════════════════════════════════════════════════════════════════════════
   Configure drawer — edit sub_assemblies / pieces / default_variants
   ════════════════════════════════════════════════════════════════════════ */

const ConfigureProductDrawer = ({ row, onClose }: { row: MfgProductRow; onClose: () => void }) => {
  const update = useUpdateMfgProductPrices();
  const initialSubs = Array.isArray(row.sub_assemblies) ? (row.sub_assemblies as string[]) : [];
  const initialPieces = (row.pieces && typeof row.pieces === 'object'
    ? row.pieces as { count: number; names: string[] }
    : { count: 0, names: [] });
  const initialVariants = (row.default_variants && typeof row.default_variants === 'object'
    ? row.default_variants as Record<string, string>
    : {});

  const [subs, setSubs] = useState<string[]>(initialSubs);
  const [subDraft, setSubDraft] = useState('');
  const [piecesCount, setPiecesCount] = useState<number>(initialPieces.count ?? 0);
  const [pieceNames, setPieceNames] = useState<string[]>(initialPieces.names ?? []);
  const [variants, setVariants] = useState<Record<string, string>>(initialVariants);

  const addSub = () => {
    const t = subDraft.trim();
    if (!t) return;
    setSubs((s) => [...s, t]);
    setSubDraft('');
  };
  const removeSub = (i: number) => setSubs((s) => s.filter((_, idx) => idx !== i));

  const submit = () => {
    update.mutate({
      id: row.id,
      subAssemblies: subs,
      pieces: { count: piecesCount, names: pieceNames.filter((n) => n.trim()) },
      defaultVariants: variants,
    }, { onSuccess: onClose });
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>Configure · {row.code}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{row.name}</p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
        </header>
        <div className={styles.drawerBody}>
          {/* Sub-Assemblies */}
          <div className={styles.section}>
            <p className={styles.eyebrow}>Sub-Assemblies ({subs.length})</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {subs.map((s, i) => (
                <span key={`${s}-${i}`} className={styles.codeChip}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {s}
                  <button type="button" onClick={() => removeSub(i)}
                    style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--c-festive-b, #B8331F)' }}>
                    <X size={11} strokeWidth={2} />
                  </button>
                </span>
              ))}
              {subs.length === 0 && <span style={{ color: 'var(--fg-soft)', fontSize: 'var(--fs-12)' }}>None yet.</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className={styles.fieldInput}
                placeholder="e.g. Divan, Headboard"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSub(); }}
                style={{ flex: 1 }}
              />
              <Button variant="primary" size="sm" onClick={addSub}>
                <Plus {...ICON_PROPS} /><span>Add</span>
              </Button>
            </div>
          </div>

          {/* Pieces */}
          <div className={styles.section}>
            <p className={styles.eyebrow}>Pieces</p>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Total Piece Count</span>
                <input type="number" className={styles.fieldInput}
                  value={piecesCount}
                  onChange={(e) => setPiecesCount(Number(e.target.value) || 0)} />
              </label>
            </div>
            <textarea
              className={styles.fieldInput}
              style={{ width: '100%', marginTop: 8, minHeight: 70 }}
              placeholder="Piece names — one per line"
              value={pieceNames.join('\n')}
              onChange={(e) => setPieceNames(e.target.value.split('\n'))}
            />
          </div>

          {/* Default Variants */}
          <div className={styles.section}>
            <p className={styles.eyebrow}>Default Variants</p>
            <div className={styles.formGrid}>
              <VariantField label="Fabric Code" value={variants.fabricCode ?? ''} onChange={(v) => setVariants((s) => ({ ...s, fabricCode: v }))} />
              <VariantField label="Divan Height" value={variants.divanHeight ?? ''} onChange={(v) => setVariants((s) => ({ ...s, divanHeight: v }))} />
              <VariantField label="Leg Height" value={variants.legHeight ?? ''} onChange={(v) => setVariants((s) => ({ ...s, legHeight: v }))} />
              <VariantField label="Gap" value={variants.gap ?? ''} onChange={(v) => setVariants((s) => ({ ...s, gap: v }))} />
              <VariantField label="Specials" value={variants.specials ?? ''} onChange={(v) => setVariants((s) => ({ ...s, specials: v }))} fullWidth />
            </div>
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save Configuration'}
          </Button>
        </footer>
      </aside>
    </div>
  );
};

const VariantField = ({
  label, value, onChange, fullWidth,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  fullWidth?: boolean;
}) => (
  <label className={`${styles.field} ${fullWidth ? styles.formGridFull : ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    <input className={styles.fieldInput} value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);

/* ════════════════════════════════════════════════════════════════════════
   Price History dialog — shows master_price_history for this product
   ════════════════════════════════════════════════════════════════════════ */

const FIELD_LABELS: Record<string, string> = {
  base_price_sen: 'Base Price (P2)',
  price1_sen:     'Price 1',
  cost_price_sen: 'Cost Price',
};

const prettifyField = (f: string): string => {
  if (FIELD_LABELS[f]) return FIELD_LABELS[f]!;
  if (f.startsWith('seat_height:')) {
    const [, rest] = f.split(':');
    const [height, tier] = (rest ?? '').split('|');
    return `Sofa ${height}" · ${(tier ?? 'PRICE_2').replace('PRICE_', 'P')}`;
  }
  return f;
};

const fmtRmSafe = (sen: number | null): string =>
  sen == null ? '—' : `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : iso;
};

const PriceHistoryDialog = ({ row, onClose }: { row: MfgProductRow; onClose: () => void }) => {
  const hist = useMfgProductPriceHistory(row.id);
  const rows = hist.data?.history ?? [];

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-cream)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-3)',
          width: 'min(820px, 95vw)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>Price history</h2>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{row.code} · {row.name}</p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
        </header>
        <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          {hist.isLoading && <p style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Loading…</p>}
          {!hist.isLoading && rows.length === 0 && (
            <p style={{ padding: 'var(--space-5)', textAlign: 'center', color: 'var(--fg-muted)' }}>
              No price changes recorded yet.
            </p>
          )}
          {!hist.isLoading && rows.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Field</th>
                  <th style={{ textAlign: 'right' }}>Old</th>
                  <th style={{ textAlign: 'right' }}>New</th>
                  <th style={{ textAlign: 'right' }}>Δ</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const oldV = r.old_value_sen ?? 0;
                  const newV = r.new_value_sen ?? 0;
                  const delta = newV - oldV;
                  const deltaColor = delta > 0 ? 'var(--c-secondary-a, #2F5D4F)'
                    : delta < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
                  return (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{fmtDateTime(r.changed_at)}</td>
                      <td>{prettifyField(r.field)}</td>
                      <td className={styles.numCell}>{fmtRmSafe(r.old_value_sen)}</td>
                      <td className={styles.numCell}>{fmtRmSafe(r.new_value_sen)}</td>
                      <td className={styles.numCell} style={{ color: deltaColor, fontWeight: 600 }}>
                        {delta > 0 ? '+' : ''}{fmtRmSafe(delta)}
                      </td>
                      <td style={{ color: 'var(--fg-muted)' }}>{r.reason ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Maintenance History dialog — shows config snapshots over time
   ════════════════════════════════════════════════════════════════════════ */

const MaintenanceHistoryDialog = ({
  activeLabel,
  activeKey,
  history,
  onClose,
}: {
  activeLabel: string;
  activeKey: MaintenanceListKey;
  history: import('../lib/mfg-products-queries').MaintenanceHistoryRow[];
  onClose: () => void;
}) => (
  <div className={styles.drawerBackdrop} onClick={onClose}>
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--c-cream)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-3)',
        width: 'min(720px, 95vw)',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className={styles.drawerHeader}>
        <h2 className={styles.drawerTitle}>Maintenance history · {activeLabel}</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {history.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
            No maintenance changes yet — the baseline migration row is the only entry.
          </p>
        )}
        {history.map((entry) => {
          const sectionValue = (entry.config as unknown as Record<string, unknown>)[activeKey];
          return (
            <div key={entry.id} style={{
              padding: 'var(--space-3)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-3)',
              background: entry.isPending ? 'rgba(232, 107, 58, 0.06)' : 'var(--c-paper)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--c-ink)' }}>
                  Effective from {entry.effectiveFrom}
                </span>
                {entry.isPending && (
                  <span style={{ background: 'rgba(232, 107, 58, 0.20)', color: 'var(--c-burnt)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-11)', fontWeight: 600 }}>
                    PENDING
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Created {fmtDateTime(entry.createdAt)}{entry.createdBy ? ` by ${entry.createdBy.slice(0, 8)}` : ''}
              </div>
              {entry.notes && (
                <p style={{ marginTop: 6, fontSize: 'var(--fs-13)', color: 'var(--c-ink)' }}>Notes: {entry.notes}</p>
              )}
              <pre style={{
                marginTop: 8,
                padding: 'var(--space-2)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-11)',
                overflow: 'auto',
                maxHeight: 200,
              }}>
                {JSON.stringify(sectionValue, null, 2)}
              </pre>
            </div>
          );
        })}
      </div>
      <footer className={styles.drawerFooter}>
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      </footer>
    </div>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   CSV Export + Import
   ════════════════════════════════════════════════════════════════════════ */

const CSV_COLUMNS = [
  'code', 'name', 'category', 'description', 'base_model', 'size_label',
  'base_price_sen', 'price1_sen', 'cost_price_sen',
  'unit_m3_milli', 'fabric_usage_centi', 'production_time_minutes',
  'status', 'branding', 'fabric_color',
] as const;

function exportSkusCsv(rows: MfgProductRow[]): void {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const cells = CSV_COLUMNS.map((col) => {
      const v = (r as unknown as Record<string, unknown>)[col];
      if (v == null) return '';
      const s = String(v);
      // RFC4180: quote if contains comma, quote, or newline
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(cells.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `2990s-skus-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ImportSkusDialog = ({ onClose }: { onClose: () => void }) => (
  <div className={styles.drawerBackdrop} onClick={onClose}>
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--c-cream)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-3)',
        width: 'min(560px, 95vw)',
        padding: 'var(--space-5)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.drawerTitle}>Import SKUs</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
      </header>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
        CSV import wires through the new POST /mfg-products endpoint one row at a time.
        For bulk seeding (200+ rows at once) keep using the SQL seed file —
        the row-by-row path here is meant for &lt;50 edits.
      </p>
      <input type="file" accept=".csv" style={{ marginTop: 'var(--space-3)' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          alert(`CSV upload received: ${f.name} (${f.size} bytes). Server-side batch import endpoint TODO — for now use seed SQL.`);
        }} />
      <footer style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      </footer>
    </div>
  </div>
);
