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
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useMfgProducts,
  useMaintenanceConfig,
  useMaintenanceConfigHistory,
  useSaveMaintenanceConfig,
  type MfgCategory,
  type MfgProductRow,
  type MaintenanceConfig,
  type PricedOption,
} from '../lib/mfg-products-queries';
import styles from './Products.module.css';

const ICON_PROPS = { size: 16, strokeWidth: 1.75 } as const;
const LG_ICON = { size: 18, strokeWidth: 1.75 } as const;

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

const fmtFabric = (centi: number): string =>
  centi === 0 ? '—' : `${(centi / 100).toFixed(0)} m`;

const SkuMasterTab = () => {
  const [category, setCategory] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);

  const { data: products, isLoading, error } = useMfgProducts({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => products ?? [], [products]);

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
          <Button variant="ghost" size="md" onClick={() => alert('Export SKUs — coming soon')}>
            <Download {...ICON_PROPS} />
            <span>Export SKUs</span>
          </Button>
          <Button variant="ghost" size="md" onClick={() => alert('Import SKUs — coming soon')}>
            <Upload {...ICON_PROPS} />
            <span>Import SKUs</span>
          </Button>
          <Button
            variant={editMode ? 'secondary' : 'primary'}
            size="md"
            onClick={() => setEditMode(!editMode)}
          >
            <Edit3 {...ICON_PROPS} />
            <span>{editMode ? 'Cancel' : 'Edit Prices'}</span>
          </Button>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading
          ? 'Loading products…'
          : `${rows.length} products · Production configs from SKU sheet`}
      </p>

      {/* Error banner — surface API failures (e.g. table not migrated yet) so
          the page doesn't look like an infinite spinner. */}
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
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product Code</th>
              <th>Description</th>
              <th>Category</th>
              <th>Size</th>
              <th style={{ textAlign: 'right' }}>Price 2</th>
              <th style={{ textAlign: 'right' }}>Price 1</th>
              <th style={{ textAlign: 'right' }}>Unit (m³)</th>
              <th style={{ textAlign: 'right' }}>Fabric</th>
              <th style={{ textAlign: 'right' }}>Total Min</th>
              <th>Variants</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-7)' }}>
                  Loading products…
                </td>
              </tr>
            )}
            {!isLoading && rows.map((row) => (
              <ProductRow key={row.id} row={row} editMode={editMode} />
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-7)' }}>
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
              Showing {rows.length} of {rows.length}
            </span>
            <span className={styles.eyebrow}>{rows.length} total products</span>
          </div>
        )}
      </div>
    </>
  );
};

const ProductRow = ({ row, editMode }: { row: MfgProductRow; editMode: boolean }) => {
  return (
    <tr>
      <td><span className={styles.codeChip}>{row.code}</span></td>
      <td>
        <div className={styles.nameMain}>{row.name}</div>
        {row.description && <div className={styles.nameSub}>{row.description}</div>}
      </td>
      <td><span className={styles.catPill}>{row.category}</span></td>
      <td>{row.size_label ?? '—'}</td>
      <td className={row.base_price_sen ? styles.price : styles.priceEmpty}>
        {fmtRm(row.base_price_sen)}
      </td>
      <td className={row.price1_sen ? styles.price : styles.priceEmpty}>
        {fmtRm(row.price1_sen)}
      </td>
      <td className={styles.numCell}>{fmtUnit(row.unit_m3_milli)}</td>
      <td className={styles.numCell}>{fmtFabric(row.fabric_usage_centi)}</td>
      <td className={styles.numCellMuted}>
        {row.production_time_minutes}
        <span className={styles.minSuffix}>min</span>
      </td>
      <td>
        <Button variant="ghost" size="sm" disabled={editMode}>
          <Settings2 {...ICON_PROPS} />
          <span>Configure</span>
        </Button>
      </td>
    </tr>
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
              const count = countItems(config, t.key);
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
            <Button variant="ghost" size="sm" onClick={() => alert(`History: ${history.data?.history.length ?? 0} entries`)}>
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
  if (listKey === 'fabrics') {
    return (
      <div className={styles.bannerWarn}>
        Fabrics editor reads from <code>fabric_trackings</code> — wire-up
        coming with the Fabric Tracking page.
      </div>
    );
  }

  // String[] tabs (gaps, sofaSizes)
  if (listKey === 'gaps' || listKey === 'sofaSizes') {
    const items = config[listKey] as string[];
    return (
      <div className={styles.maintList}>
        {items.map((v, i) => (
          <div key={`${v}-${i}`} className={styles.maintRow}>
            <button type="button" className={styles.maintRowIcon} title="History">
              <History {...ICON_PROPS} />
            </button>
            <span className={styles.maintRowIdx}>{i + 1}</span>
            <span className={styles.maintRowValue}>{v}</span>
            <span />
          </div>
        ))}
      </div>
    );
  }

  // PricedOption[] tabs (the rest)
  const items = config[listKey] as PricedOption[];

  return (
    <div className={styles.maintList}>
      {items.map((opt, i) => (
        <div key={`${opt.value}-${i}`} className={styles.maintRow}>
          <button type="button" className={styles.maintRowIcon} title="History">
            <History {...ICON_PROPS} />
          </button>
          <span className={styles.maintRowIdx}>{i + 1}</span>
          <span className={styles.maintRowValue}>{opt.value}</span>
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
        </div>
      ))}
      {!priced && <p className={styles.eyebrow}>No surcharge pricing for this list.</p>}
    </div>
  );
};
