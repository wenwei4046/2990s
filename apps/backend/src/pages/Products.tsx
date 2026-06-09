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

import { memo, useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  Download,
  Upload,
  Edit3,
  Search,
  History,
  Package,
  Trash2,
  Plus,
  X,
  Truck,
  Star,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  SOFA_MODULES,
  resolveSofaQuickPresets,
  normalizeSofaTier,
  type SofaQuickPreset,
} from '@2990s/shared';
import {
  useMfgProducts,
  useUpdateMfgProductPrices,
  useCreateMfgProduct,
  useBatchImportMfgProducts,
  useDeleteMfgProduct,
  useMaintenanceConfig,
  useMaintenanceConfigHistory,
  useSaveMaintenanceConfig,
  useRenameSofaCompartment,
  useMfgProductSuppliers,
  useUploadSofaCompartmentPhoto,
  useDeleteSofaCompartmentPhoto,
  type MfgCategory,
  type MfgProductRow,
  type BatchImportRow,
  type BatchImportResult,
  type MaintenanceConfig,
  type PricedOption,
  type SeatHeightPrice,
  type SofaPriceTier,
  type ProductSupplierRow,
} from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import { SkeletonRows } from '../components/Skeleton';
import { FabricsTable } from '../components/FabricsTable';
import { SofaComboTab } from '../components/SofaComboTab';
import { SpecialAddonsTab } from '../components/SpecialAddonsTab';
import { FabricTracking } from './FabricTracking';
import { formatSizeRich, formatSizeRichWithCfg, resolveSizeInfo } from '../lib/size-info';
import { ProductModels, NewModelDialog } from './ProductModels';
import { useQueryClient } from '@tanstack/react-query';
import styles from './Products.module.css';

const ICON_PROPS = { size: 16, strokeWidth: 1.75 } as const;

type TopTab = 'sku' | 'modular' | 'special-addons' | 'maintenance' | 'combos' | 'fabric';


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
            {/* PR #84 — Commander 2026-05-26 wanted a dedicated place to
                manage per-Model specs (allowed options, thickness, etc.)
                separately from "create code" and SKU adjustments. The
                Modular tab routes into the same ProductModels list that
                used to live under /product-models — restoring an entry
                point (PR #73 removed the old Models tab; this is its
                replacement with a clearer name). */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'modular'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('modular')}
            >
              Modular
            </button>
            {/* Special Add-ons — Backend parity with the POS tab (Loo
                2026-06-08). Product Add-ons (special_addons) replaces the
                legacy Maintenance > Specials editor; Order Add-ons mirrors
                the POS order-fee manager. Same shared API as POS. */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'special-addons'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('special-addons')}
            >
              Special Add-ons
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
            {/* PR #237 — Sofa Combo Pricing (Commander 2026-05-28
                "去查看 hookka 的 combo module 把整个 copy 过来"). Module-set
                combo deals that OVERRIDE per-Model compartment pricing. */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'combos'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('combos')}
            >
              Combo Pricing
            </button>
            {/* Fabric Converter — moved out of the sidebar to sit next to
                Combo Pricing (commander 2026-05-28). Renders the existing
                FabricTracking page inline; the /fabric-tracking route is kept
                for back-compat / direct links. */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'fabric'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('fabric')}
            >
              Fabric Converter
            </button>
          </div>
        </div>
      </header>

      {topTab === 'sku' && <SkuMasterTab />}
      {topTab === 'modular' && <ProductModels />}
      {topTab === 'special-addons' && <SpecialAddonsTab />}
      {topTab === 'maintenance' && <MaintenanceTab />}
      {topTab === 'combos' && <SofaComboTab />}
      {topTab === 'fabric' && <FabricTracking />}
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
  // PR #39 — Model filter chip row (visible only on Sofa view).
  // Distinct base_model values pulled from current rows. 'all' = no filter.
  const [modelFilter, setModelFilter] = useState<string>('all');
  // One-shot filter — narrows the grid to one_shot=true rows only.
  const [oneShotOnly, setOneShotOnly] = useState(false);

  const { data: products, isLoading, error } = useMfgProducts({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });
  const config = useMaintenanceConfig('master');

  const allRows = useMemo(() => products ?? [], [products]);
  const isSofaView = category === 'SOFA';
  const isMattressView = category === 'MATTRESS';
  // Memoized so its reference is stable across renders — otherwise the fallback
  // array literal would change every render and defeat ProductRow's React.memo.
  const sofaSizes = useMemo(
    () => config.data?.data?.sofaSizes ?? ['24', '26', '28', '30', '32', '35'],
    [config.data],
  );

  // PR #39 + #107 — distinct base_model values for the current category.
  // Commander 2026-05-26: "为什么 bedframe 没有像 sofa 那样". Extended from
  // SOFA-only to BEDFRAME + MATTRESS too so commander can narrow the SKU
  // list to a single Model (Hilton bedframes, Purezone mattresses, etc.).
  // ACCESSORY + SERVICE skip the filter — they don't carry a base_model.
  const supportsModelFilter = category === 'SOFA' || category === 'BEDFRAME' || category === 'MATTRESS';
  const categoryModels = useMemo<string[]>(() => {
    if (!supportsModelFilter) return [];
    const s = new Set<string>();
    for (const r of allRows) if (r.base_model) s.add(r.base_model);
    return Array.from(s).sort();
  }, [allRows, supportsModelFilter]);

  // Apply Model filter (only when current category supports it + a specific
  // model is picked), then apply the one-shot filter.
  const rows = useMemo(() => {
    let base = allRows;
    if (supportsModelFilter && modelFilter !== 'all') {
      base = base.filter((r) => r.base_model === modelFilter);
    }
    if (oneShotOnly) {
      base = base.filter((r) => r.one_shot === true);
    }
    return base;
  }, [allRows, supportsModelFilter, modelFilter, oneShotOnly]);

  // Reset Model filter when leaving a category that doesn't support it
  useEffect(() => {
    if (!supportsModelFilter && modelFilter !== 'all') setModelFilter('all');
  }, [supportsModelFilter, modelFilter]);

  // Drawer + modal state
  const [newSkuOpen, setNewSkuOpen] = useState(false);
  const [suppliersRow, setSuppliersRow] = useState<MfgProductRow | null>(null);
  const [importing, setImporting] = useState(false);
  // PR #73 — "+ New SKU" now opens the Model creation dialog (with the
  // active category filter pre-filled). The legacy single-SKU drawer
  // stays around in `newSkuOpen` for the ACCESSORY / SERVICE fall-back
  // where a Model template isn't useful.
  const [newModelOpen, setNewModelOpen] = useState(false);
  const qc = useQueryClient();
  // Map the SKU Master category-filter values to MfgCategory. `all` becomes
  // undefined so the dialog defaults to SOFA on its own.
  const initialCategoryForDialog: MfgCategory | undefined =
    category === 'all' ? undefined : (category as MfgCategory);

  // PR #82 (Commander 2026-05-26) — multi-select delete. Set<id> tracks
  // ticked rows; select-all checkbox toggles every visible row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const deleteMut = useDeleteMfgProduct();
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selectedIds.has(id));
  // Stable identity so it can be passed straight to the memoized ProductRow
  // (no per-row inline closure → only the toggled row re-renders).
  const toggleRow = useCallback((id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    }), []);
  const toggleAllVisible = () =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) n.delete(id);
      } else {
        for (const id of visibleIds) n.add(id);
      }
      return n;
    });
  // Drop selections that disappeared from the visible list (category /
  // search change). Prevents "Delete 3" claiming rows that aren't on
  // screen.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const vis = new Set(visibleIds);
      const next = new Set<string>();
      for (const id of prev) if (vis.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete ${selectedIds.size} SKU${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.all(ids.map((id) =>
      deleteMut.mutateAsync(id).then(() => ({ id, ok: true as const })).catch((e) => ({ id, ok: false as const, err: e instanceof Error ? e.message : String(e) })),
    ));
    setDeleting(false);
    const failed = results.filter((r): r is { id: string; ok: false; err: string } => !r.ok);
    setSelectedIds(new Set());
    if (failed.length === 0) return;

    // PR #94 — Commander 2026-05-26: the "Deleted 0 / 6. 6 failed" alert
    // hid the actual reason behind a generic message. Surface per-row
    // errors so commander can see WHAT is blocking (inventory lot,
    // supplier binding, etc.) and offer Force delete as a follow-up.
    const blockedByRef = failed.filter((f) => /product_in_use|23503|references/i.test(f.err));
    const sample = failed.slice(0, 3).map((f) => `· ${f.err.slice(0, 160)}`).join('\n');
    const overflow = failed.length > 3 ? `\n…and ${failed.length - 3} more.` : '';
    // eslint-disable-next-line no-alert
    const wantForce = blockedByRef.length > 0 && confirm(
      `Deleted ${results.length - failed.length} / ${results.length}. ${failed.length} failed:\n${sample}${overflow}\n\n`
      + `${blockedByRef.length} of the failures look like inventory / supplier bindings.\n`
      + `Force delete will wipe those side-table rows first then drop the SKU. Continue?`,
    );
    if (!wantForce) {
      // eslint-disable-next-line no-alert
      alert(`Deleted ${results.length - failed.length} / ${results.length}. ${failed.length} failed.\n${sample}${overflow}`);
      return;
    }
    setDeleting(true);
    const retry = await Promise.all(failed.map((f) =>
      deleteMut.mutateAsync({ id: f.id, force: true }).then(() => ({ id: f.id, ok: true as const })).catch((e) => ({ id: f.id, ok: false as const, err: e instanceof Error ? e.message : String(e) })),
    ));
    setDeleting(false);
    const stillFailed = retry.filter((r) => !r.ok);
    if (stillFailed.length === 0) {
      // eslint-disable-next-line no-alert
      alert(`Force delete cleaned up the remaining ${retry.length} SKU${retry.length === 1 ? '' : 's'}.`);
    } else {
      const stillSample = stillFailed.slice(0, 3).map((r) => `· ${r.ok ? '' : r.err.slice(0, 160)}`).join('\n');
      // eslint-disable-next-line no-alert
      alert(`Force delete: ${retry.length - stillFailed.length} / ${retry.length} succeeded. ${stillFailed.length} still failed:\n${stillSample}`);
    }
  };

  // Total column count (header colspan for loading/empty states):
  //   PR #82 — leading checkbox column added (+1).
  //   PR #38 — Configure + History columns removed. Double-click a row to
  //   open the Suppliers drawer.
  //   - Sofa: select + code + desc + model + N sizes + unit
  //   - Mattress: select + code + desc + branding + size + price + unit
  //   - Other: select + code + desc + category + size + P2 + P1 + unit
  const colCount = 1 + (isSofaView
    ? 3 + sofaSizes.length + 1
    : isMattressView
      ? 6
      : 7);

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
          {/* One-shot filter chip — narrows to SKUs minted from a remark. */}
          <CategoryChip
            active={oneShotOnly}
            onClick={() => setOneShotOnly((v) => !v)}
          >
            One-shot
          </CategoryChip>
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
          <Button variant="ghost" size="md" onClick={() => exportSkusCsv(rows, sofaSizes, tier)}>
            <Download {...ICON_PROPS} />
            <span>Export SKUs</span>
          </Button>
          <Button variant="ghost" size="md" onClick={() => setImporting(true)}>
            <Upload {...ICON_PROPS} />
            <span>Import SKUs</span>
          </Button>
          <Button variant="ghost" size="md" onClick={() => setNewModelOpen(true)}>
            <Plus {...ICON_PROPS} />
            <span>New SKU</span>
          </Button>
          {/* PR #82 — only render the bulk Delete button when at least one row
              is ticked, so the toolbar stays compact in normal use. */}
          {selectedIds.size > 0 && (
            <Button
              variant="secondary"
              size="md"
              onClick={bulkDelete}
              disabled={deleting}
              style={{ color: 'var(--c-festive-b, #B8331F)' }}
            >
              <Trash2 {...ICON_PROPS} />
              <span>{deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}</span>
            </Button>
          )}
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

      {/* PR #39 + #107 — Model filter chips, available on SOFA / BEDFRAME /
          MATTRESS. ACCESSORY + SERVICE skip — no base_model on those rows.
          PR — Commander 2026-05-28 ("100个 model 不是排到尾巴去了吗"): when
          the Model count exceeds MODEL_PILLS_VISIBLE_LIMIT we collapse the
          extras behind a "More (N) ▼" pill that opens a searchable popover.
          The currently-selected Model is always promoted into the visible
          row so commander can see the active filter without opening the
          popover. */}
      {supportsModelFilter && categoryModels.length > 1 && (
        <ModelFilterRail
          models={categoryModels}
          activeModel={modelFilter}
          onChange={setModelFilter}
        />
      )}

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
        {/* PR — viewport-fill scroll wrapper (matches DataGrid .scroll). The
            SKU table used to leave dead space below it; now it stretches to
            near the full viewport and scrolls internally with a sticky header.
            The record footer below stays pinned to the card. */}
        <div className={styles.skuScroll}>
        <table className={`${styles.table} ${styles.tableCompact}`}>
          <thead>
            <tr>
              {/* PR #82 — leading select-all checkbox. Indeterminate when
                  partial selection on visible rows. */}
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  aria-label="Select all visible SKUs"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAllVisible}
                  style={{ cursor: 'pointer' }}
                />
              </th>
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
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonRows cols={colCount} rows={12} />}
            {!isLoading && rows.map((row) => (
              <ProductRow
                key={row.id}
                row={row}
                editMode={editMode}
                isSofaView={isSofaView}
                isMattressView={isMattressView}
                sofaSizes={sofaSizes}
                tier={tier}
                onOpenSuppliers={setSuppliersRow}
                selected={selectedIds.has(row.id)}
                onToggleSelected={toggleRow}
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
        </div>
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
      {newModelOpen && (
        <NewModelDialog
          onClose={() => setNewModelOpen(false)}
          initialCategory={initialCategoryForDialog}
          onCreated={(_modelId) => {
            // PR #103 — Commander 2026-05-26: "为什么 create code 会跳
            // 第二页的界面". The bulk dialog already generates SKUs in one
            // shot (the "Create 1×5 = 5 SKUs" button) — no reason to also
            // drag commander onto the Model detail page afterwards. Just
            // refresh both Modular + SKU Master lists in place and close
            // the dialog. New rows surface where commander already is.
            qc.invalidateQueries({ queryKey: ['product-models'] });
            qc.invalidateQueries({ queryKey: ['mfg-products'] });
            setNewModelOpen(false);
          }}
        />
      )}
      {suppliersRow && <ProductSuppliersDrawer row={suppliersRow} onClose={() => setSuppliersRow(null)} />}
      {importing && <ImportSkusDialog sofaSizes={sofaSizes} onClose={() => setImporting(false)} />}
    </>
  );
};

const ProductRow = memo(({
  row, editMode, isSofaView, isMattressView, sofaSizes, tier, onOpenSuppliers,
  selected, onToggleSelected,
}: {
  row: MfgProductRow;
  editMode: boolean;
  isSofaView: boolean;
  isMattressView: boolean;
  sofaSizes: string[];
  tier: Tier;
  onOpenSuppliers?: (row: MfgProductRow) => void;
  /** PR #82 — multi-select state lives on SkuMasterTab; row just renders
      the checkbox + reports clicks. */
  selected:         boolean;
  onToggleSelected: (id: string) => void;
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
    <tr
      className={styles.rowCompact}
      onDoubleClick={() => !editMode && onOpenSuppliers?.(row)}
      title={editMode
        ? 'Click the truck icon to see suppliers (double-click is disabled in Edit Prices mode)'
        : 'Double-click row — or click the truck icon — to see suppliers for this product'}
      style={{ cursor: editMode ? 'default' : 'pointer' }}
    >
      {/* PR #82 — row checkbox. stopPropagation so clicking the box
          doesn't bubble into the double-click "open suppliers" handler. */}
      <td style={{ width: 32 }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          aria-label={`Select ${row.code}`}
          checked={selected}
          onChange={() => onToggleSelected(row.id)}
          style={{ cursor: 'pointer' }}
        />
      </td>
      {/* PR #89 — click code chip to edit.
          PR #95 — Commander 2026-05-26: "容易不小心点到 Edit，你应该点 Edit
          Price 那边就可以进来修改了". Gate click-to-edit behind editMode so
          the chip is read-only until commander explicitly hits "Edit Prices".
          When editMode is off the cell stops bubble propagation but stays
          a plain text/chip, so accidental clicks during row drilldown can't
          drop into the input.
          PR — Commander 2026-05-28 ("双击点不进去，看得到里面的 supplier
          是谁"): add an explicit Truck icon next to the code chip that ALWAYS
          opens the Suppliers drawer (including during edit-mode where the
          row-level double-click is intentionally disabled). */}
      <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            aria-label={`View suppliers for ${row.code}`}
            title="View suppliers carrying this SKU"
            onClick={() => onOpenSuppliers?.(row)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              color: 'var(--fg-muted)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <Truck size={13} strokeWidth={1.75} />
          </button>
          <EditableTextCell
            value={row.code}
            chipClassName={styles.codeChip}
            ariaLabel="Edit product code"
            editable={editMode}
            onSave={(val) => update.mutate({ id: row.id, code: val })}
          />
        </span>
      </td>
      {/* PR #89 — click description to edit. Description stored in the
          `name` column on mfg_products (commander calls it "description"
          in the UI). */}
      <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <EditableTextCell
            value={row.name}
            chipClassName={styles.nameCompact}
            inline
            ariaLabel="Edit description"
            editable={editMode}
            onSave={(val) => update.mutate({ id: row.id, name: val })}
          />
          {row.one_shot && (
            <span
              className={styles.catPill}
              title={row.source_doc_no ? `One-shot from ${row.source_doc_no}` : 'One-shot SKU'}
              style={{ fontSize: 'var(--fs-11)' }}
            >
              one-shot
            </span>
          )}
        </span>
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
    </tr>
  );
});
ProductRow.displayName = 'ProductRow';

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
   ModelFilterRail — visible pills + "More (N) ▼" popover with search.

   PR — Commander 2026-05-28 ("100个 model 不是排到尾巴去了吗"). At 4 Models
   the row reads fine. At 100 the pills overflow horizontally off the page.
   This wrapper keeps the first MODEL_PILLS_VISIBLE_LIMIT pills inline; the
   rest hide behind a popover with a search input + scrolling list. The
   active Model is always promoted into the visible row so commander can
   see what's filtering without opening the popover.

   Implementation notes:
     - Click-outside closes the popover (mousedown listener on document).
     - Esc also closes; search input autofocuses on open.
     - No portal — popover positions absolutely under the "More" pill via
       the wrapper's `position: relative`. Good enough at this density.
   ════════════════════════════════════════════════════════════════════════ */

const MODEL_PILLS_VISIBLE_LIMIT = 12;

const ModelFilterRail = ({
  models,
  activeModel,
  onChange,
}: {
  models: string[];
  activeModel: string;
  onChange: (m: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Decide which pills go inline vs into the "More" popover. The active
  // Model (non-"all") is always promoted into the inline set.
  const { inline, overflow } = useMemo(() => {
    if (models.length <= MODEL_PILLS_VISIBLE_LIMIT) {
      return { inline: models, overflow: [] as string[] };
    }
    const head = models.slice(0, MODEL_PILLS_VISIBLE_LIMIT);
    const tail = models.slice(MODEL_PILLS_VISIBLE_LIMIT);
    if (activeModel !== 'all' && tail.includes(activeModel)) {
      // Promote the active model into the visible row — swap with the last
      // inline pill so the inline count stays stable.
      const promoted = [...head.slice(0, -1), activeModel];
      const demoted = [head[head.length - 1]!, ...tail.filter((m) => m !== activeModel)];
      return { inline: promoted, overflow: demoted };
    }
    return { inline: head, overflow: tail };
  }, [models, activeModel]);

  // Close popover on click outside + Esc.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filteredOverflow = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overflow;
    return overflow.filter((m) => m.toLowerCase().includes(q));
  }, [overflow, search]);

  return (
    <div
      ref={wrapperRef}
      className={styles.categoryChips}
      style={{
        marginTop: 'var(--space-2)',
        flexWrap: 'wrap',
        position: 'relative',
        rowGap: 'var(--space-2)',
      }}
    >
      <CategoryChip
        active={activeModel === 'all'}
        onClick={() => onChange('all')}
      >
        All Models
      </CategoryChip>
      {inline.map((m) => (
        <CategoryChip
          key={m}
          active={activeModel === m}
          onClick={() => onChange(m)}
        >
          {m}
        </CategoryChip>
      ))}
      {overflow.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            style={{
              fontFamily: 'var(--font-button)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              letterSpacing: '0.02em',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--line)',
              background: 'var(--c-paper)',
              color: 'var(--c-ink)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>More ({overflow.length})</span>
            <ChevronDown size={12} strokeWidth={1.75} />
          </button>
          {open && (
            <div
              role="listbox"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                zIndex: 50,
                width: 280,
                maxHeight: 360,
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--c-paper)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-2)',
                padding: 'var(--space-2)',
              }}
            >
              <input
                autoFocus
                type="search"
                value={search}
                placeholder="Search models…"
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-13)',
                  background: 'var(--c-cream)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  outline: 'none',
                  marginBottom: 'var(--space-2)',
                }}
              />
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {filteredOverflow.length === 0 && (
                  <p style={{
                    fontSize: 'var(--fs-12)',
                    color: 'var(--fg-muted)',
                    padding: 'var(--space-2)',
                    textAlign: 'center',
                  }}>
                    No models match “{search}”.
                  </p>
                )}
                {filteredOverflow.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={activeModel === m}
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                      setSearch('');
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-13)',
                      padding: '4px var(--space-2)',
                      background: activeModel === m ? 'var(--c-cream)' : 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--c-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Maintenance tab
   ════════════════════════════════════════════════════════════════════════ */

type MaintenanceListKey =
  | 'bedframeSizes'    // PR #50 — Bedframe size pool (K/Q/S/SS/SK/SP)
  | 'divanHeights'
  | 'totalHeights'
  | 'gaps'
  | 'legHeights'
  | 'specials'
  | 'sofaCompartments' // PR #50 — Sofa compartment pool (1A(LHF), 1A(RHF), 1NA, ...)
  | 'sofaSizes'
  | 'sofaLegHeights'
  | 'sofaSpecials'
  | 'sofaQuickPresets' // PR (Commander 2026-05-28) — module-composition presets
  | 'mattressSizes'    // PR #50 — Mattress size pool (K/Q/S/SS)
  | 'fabrics';

// PR #208 — exported so SupplierDetail can pass a `sectionFilter` prop to
// the reused MaintenanceTab.
export type MaintenanceSection = 'Bedframe' | 'Sofa' | 'Common' | 'Products Maintenance';

const MAINTENANCE_TABS: {
  key: MaintenanceListKey;
  label: string;
  description: string;
  priced: boolean;
  section: MaintenanceSection;
}[] = [
  // ── Bedframe (commander-edited variant pools) ───────────────────────────
  { key: 'divanHeights', label: 'Divan Heights', description: 'Bedframe divan height options with surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'totalHeights', label: 'Total Heights', description: 'Total height (Divan + Gap + Leg) surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'gaps', label: 'Gaps', description: 'Bedframe gap height options (inches)', priced: false, section: 'Bedframe' },
  { key: 'legHeights', label: 'Leg Heights', description: 'Bedframe leg height options with surcharge pricing', priced: true, section: 'Bedframe' },
  // 'specials' retired 2026-06-08 (Loo) — bedframe special orders moved to the
  // Special Add-ons tab (special_addons / Product Add-ons), shared with POS.

  // ── Sofa (commander-edited variant pools) ───────────────────────────────
  { key: 'sofaSizes', label: 'Sizes', description: 'Available sofa seat height sizes (inches)', priced: false, section: 'Sofa' },
  { key: 'sofaLegHeights', label: 'Leg Heights', description: 'Sofa leg height options with surcharge pricing', priced: true, section: 'Sofa' },
  // 'sofaSpecials' retired 2026-06-08 (Loo) — sofa special orders moved to the
  // Special Add-ons tab (special_addons / Product Add-ons), shared with POS.
  // Quick Presets editor entry retired (Chairman 2026-06-02) — removed from the
  // Maintenance rail in both apps. The sofaQuickPresets DATA + the shared
  // DEFAULT_SOFA_QUICK_PRESETS fallback are kept (Sofa Combos reference preset
  // ids; POS Quick Pick reads sofa_quick_picks, a different table).

  // ── Common (cross-category single pool) ─────────────────────────────────
  { key: 'fabrics', label: 'Fabrics', description: 'Fabric price tier assignment — drives Price 1 / Price 2', priced: false, section: 'Common' },

  // ── Products Maintenance (cross-category, drives Model "+ Add Codes") ──
  // PR #74 (Commander 2026-05-26): bedframeSizes / mattressSizes / sofaCompartments
  // live here because they're shared by multiple Models and back the bulk
  // SKU generator — they're conceptually "Products Maintenance" rather than
  // per-category variant config.
  { key: 'bedframeSizes',    label: 'Bedframe Sizes',    description: 'Bedframe sizes — edit code · label · dimensions (e.g. K · 6FT · 183X190CM). Used in generated SKU names.', priced: false, section: 'Products Maintenance' },
  { key: 'mattressSizes',    label: 'Mattress Sizes',    description: 'Mattress sizes — edit code · label · dimensions. Used in generated SKU names + width/length placeholders.', priced: false, section: 'Products Maintenance' },
  { key: 'sofaCompartments', label: 'Sofa Compartments', description: 'Sofa compartment pool (1A(LHF), 1A(RHF), 1NA, 2A(LHF), ...). Models tick which they offer.', priced: false, section: 'Products Maintenance' },
];

/**
 * Maintenance tab.
 *
 * PR #208 (Commander 2026-05-27) — exported + parameterised so SupplierDetail
 * can mount the same UI scoped to a specific supplier. Defaults preserve
 * the original Products-page behaviour: scope='master' and every section
 * is visible.
 *
 *   scope          — maintenance_config_history.scope to read + write.
 *   sectionFilter  — optional allow-list of MaintenanceSection labels. Omit
 *                    to show every section.
 *   emptyHint      — optional message rendered when this scope has no row
 *                    yet AND the master fallback also has none. Supplier
 *                    Detail uses this to nudge "Click Edit to seed".
 *   singleCostColumn — when true, hide the redundant costSen "COST RM"
 *                    column and relabel the kept priceSen column "Cost".
 *                    Supplier Detail sets this because on a supplier the
 *                    surcharge IS our cost — a second cost column confuses.
 *                    Defaults false → Products-page behaviour unchanged.
 */
export const MaintenanceTab = ({
  scope = 'master',
  sectionFilter,
  emptyHint,
  singleCostColumn = false,
}: {
  scope?: string;
  sectionFilter?: MaintenanceSection[];
  emptyHint?: ReactNode;
  singleCostColumn?: boolean;
} = {}) => {
  const resolved = useMaintenanceConfig(scope);
  const history = useMaintenanceConfigHistory(scope);
  const save = useSaveMaintenanceConfig();
  const renameCompartment = useRenameSofaCompartment();

  // PR #208 — when the supplier scope has no row yet, fall through to the
  // master config so commander can see what's there before deciding to
  // override. Save still writes back to the prop scope, never to master —
  // the fallback never silently mutates the global config.
  const masterFallback = useMaintenanceConfig('master', {
    enabled: scope !== 'master' && !resolved.data?.data && !resolved.isLoading,
  });

  // PR #208 — sectionFilter restricts which sections show on the left rail.
  // BEDFRAME-only supplier hides Sofa sub-tabs entirely so commander only
  // edits surcharges that actually apply to what this supplier supplies.
  const allSections: MaintenanceSection[] = ['Bedframe', 'Sofa', 'Common', 'Products Maintenance'];
  const sections: MaintenanceSection[] = sectionFilter ?? allSections;
  const visibleTabs = useMemo(
    () => MAINTENANCE_TABS.filter((t) => sections.includes(t.section)),
    [sections],
  );

  // First visible tab — the section filter may have hidden 'divanHeights'.
  const defaultActiveKey: MaintenanceListKey = visibleTabs[0]?.key ?? 'divanHeights';

  const [activeKey, setActiveKey] = useState<MaintenanceListKey>(defaultActiveKey);

  // Keep activeKey valid when the section filter changes (e.g. supplier
  // category switched). Pin to the first visible tab if the current one
  // got filtered out.
  useEffect(() => {
    if (!visibleTabs.find((t) => t.key === activeKey)) {
      setActiveKey(defaultActiveKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs]);

  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<MaintenanceConfig | null>(null);
  const [showMaintHistory, setShowMaintHistory] = useState(false);

  // Count fabric_trackings rows for the left-rail "Fabrics (N)" badge.
  // Lightweight query (cached 30s) — uses the same hook as the panel itself.
  const fabricsList = useFabricTrackings();
  const fabricsCount = fabricsList.data?.length ?? 0;

  // PR #208 — draft beats supplier-scope-resolved beats master-fallback.
  // Any of those three can be null (commander hasn't seeded yet).
  const config =
    draft ?? resolved.data?.data ?? masterFallback.data?.data ?? null;
  const active = MAINTENANCE_TABS.find((t) => t.key === activeKey) ?? visibleTabs[0];

  const startEdit = () => {
    // Seed the draft from whichever config we're currently showing — could
    // be the supplier-scope row or the master fallback. Either way commander
    // edits a copy; save writes back to `scope`.
    const seed = resolved.data?.data ?? masterFallback.data?.data ?? null;
    if (!seed) return;
    setDraft(JSON.parse(JSON.stringify(seed)) as MaintenanceConfig);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditMode(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    const effectiveFrom = window.prompt('Effective from (YYYY-MM-DD)?', new Date().toISOString().slice(0, 10));
    if (!effectiveFrom) return;
    // Maintenance-is-master cascade (Loo 2026-06-04: "what maintenance change
    // all will follow"). Detect in-place compartment code RENAMES (same row,
    // new text, old code gone from the list, new code not previously there)
    // and run the atomic cascade BEFORE appending the new config row, so the
    // SKU master, every doc snapshot, Modular ticks, combos and quick picks
    // all carry the new name the moment the save lands. Master scope only —
    // supplier scopes are surcharge overlays, never the code authority.
    if (scope === 'master') {
      const baseline =
        resolved.data?.data?.sofaCompartments ?? masterFallback.data?.data?.sofaCompartments ?? [];
      const next = draft.sofaCompartments ?? [];
      const renames: Array<{ from: string; to: string }> = [];
      const len = Math.min(baseline.length, next.length);
      for (let i = 0; i < len; i++) {
        const from = (baseline[i] ?? '').trim();
        const to = (next[i] ?? '').trim();
        if (!from || !to || from === to) continue;
        if (!next.includes(from) && !baseline.includes(to)) renames.push({ from, to });
      }
      if (renames.length > 0) {
        const summary = renames.map((r) => `${r.from} → ${r.to}`).join('\n');
        // eslint-disable-next-line no-alert
        const ok = confirm(
          `Rename compartment code${renames.length > 1 ? 's' : ''}?\n\n${summary}\n\n` +
          `This cascades EVERYWHERE: SKU codes + names, sales orders (incl. history), ` +
          `delivery orders, invoices, GRN/PO lines, Modular ticks, Combos and Quick Picks.`,
        );
        if (!ok) return;
        for (const r of renames) {
          try {
            await renameCompartment.mutateAsync(r);
          } catch (e) {
            // eslint-disable-next-line no-alert
            alert(`Rename ${r.from} → ${r.to} failed: ${e instanceof Error ? e.message : String(e)}\nNothing was partially renamed for this pair; fix and retry.`);
            return;
          }
        }
      }
    }
    // PR #208 — write back to the same scope this tab was mounted with.
    // Supplier scope (e.g. 'supplier:abc-123') gets its own append-only row;
    // master scope is unchanged for the SO / selling-price flow.
    save.mutate(
      { scope, config: draft, effectiveFrom },
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
        {emptyHint ?? (
          <>
            No maintenance config baseline found. The migration ran but the master
            baseline row is missing — re-apply migration 0039 to seed it.
          </>
        )}
      </div>
    );
  }

  // active falls through to the first visible tab when the section filter
  // hides the previously-active key. Should never be null when config is set,
  // but guard anyway.
  if (!active) {
    return (
      <div className={styles.bannerWarn}>
        No maintenance sections visible for this scope.
      </div>
    );
  }

  // PR #208 — show "using fallback" hint when the supplier scope is empty
  // but the master fallback is rendering. Encourages commander to hit Edit
  // → Save which seeds this supplier's own row.
  const showingMasterFallback =
    scope !== 'master' && !resolved.data?.data && Boolean(masterFallback.data?.data);

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
            {showingMasterFallback && (
              <p className={styles.stateInfo} style={{ marginTop: 8, color: 'var(--c-burnt)' }}>
                No supplier-specific pricing yet — showing the master baseline.
                Hit Edit + Save to override.
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
          singleCostColumn={singleCostColumn}
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
  // Quick Presets falls back to DEFAULT_SOFA_QUICK_PRESETS when the
  // maintenance row hasn't been migrated yet — show the resolved count
  // so the left-rail badge isn't misleadingly "0".
  if (key === 'sofaQuickPresets') {
    return resolveSofaQuickPresets(cfg.sofaQuickPresets).length;
  }
  // PR #74 — Code Format tabs removed (Commander 2026-05-26: preset only,
  // not commander-editable). The cfg.{category}CodeFormat / NameFormat
  // columns still exist on the JSONB blob but no longer surface in the UI;
  // the API falls back to its hardcoded templates when those fields are
  // empty (see apps/api/src/routes/product-models.ts §generate).
  const v = cfg[key as keyof MaintenanceConfig];
  return Array.isArray(v) ? v.length : 0;
};

/* ─── Sofa Compartments — POS module catalogue port (PR #220) ─────────
   Commander 2026-05-27: "把我在 POS System 设计好的模块放进 Maintenance Sofa
   Compartments." Each compartment row gets an image + description +
   default price. The compartment-code list (config.sofaCompartments)
   stays a `string[]` so existing readers (ProductModelDetail allowed
   options, SKU generator) keep working untouched. Per-compartment meta
   lives in a parallel `sofaCompartmentMeta` map keyed by code.

   Code-format note: SOFA_MODULES ids, the pool and the meta map all share
   the ONE canonical parens vocabulary (`1A(LHF)`, 2026-06-04).
   normalizeCompartmentCode canonicalizes a stray legacy dash entry so the
   lookup still hits. */

type CompartmentMeta = {
  imageKey?: string;
  description?: string;
  defaultPriceCenti?: number;
};

// Canonicalize any compartment input to the parens form (mirror of the
// shared normalizeCompartmentCode — kept local so this page stays light).
const normalizeCompartmentCode = (raw: string): string => {
  const dash = raw.trim().replace(/\(([^)]*)\)/g, '-$1').replace(/-+$/, '');
  const parts = dash.split('-').filter(Boolean);
  if (parts.length <= 1) return dash;
  return (parts[0] ?? '') + parts.slice(1).map((p) => `(${p})`).join('');
};

const SOFA_MODULE_BY_NORM_ID = new Map(
  SOFA_MODULES.map((m) => [normalizeCompartmentCode(m.id), m]),
);

// Commander 2026-05-27 definitive taxonomy (CORRECTED):
//
//   nS  = N seats with arms on BOTH sides (1S = 1 seat + 2 arms)
//   nA  = N seats with arm on ONE side (LHF/RHF says which side has arm)
//   nB  = N seats — the LHF/RHF side's "arm position" is a Seat Cushion
//         (bench) instead of a real arm. Commander rule: "Left 就是左边是
//         坐垫的意思" — 1B(LHF) means LEFT is bench, RIGHT has the arm.
//   nNA = N seats, NO arms
//   (P) suffix = Power Recliner (electric)
//   (R) suffix = Manual Recliner
//   CNR = Corner piece (90° L-shape connector — NOT a console)
//   WC-45 = Wood Console (45cm) — divider/storage between two seats
// Keys are the canonical parens codes (lookups go through
// normalizeCompartmentCode first, so a stray legacy dash entry still hits).
const COMPARTMENT_DESCRIPTION_OVERRIDE: Record<string, string> = {
  // ── 1-Seaters ──────────────────────────────────────────────────────
  '1S':     '1 seat, arms on BOTH sides',
  '1A(LHF)': '1 seat, ONE arm (left)',
  '1A(RHF)': '1 seat, ONE arm (right)',
  '1B(LHF)': '1 seat — LEFT is Seat Cushion (bench), no arm on the right',
  '1B(RHF)': '1 seat — RIGHT is Seat Cushion (bench), no arm on the left',
  '1NA':    '1 seat, NO arms',

  // ── 1-Seater Recliners ────────────────────────────────────────────
  // (P) = Power Recliner (electric) · (R) = Manual Recliner
  '1A(P)(LHF)': '1 seat + ONE arm (left) — Power Recliner (electric)',
  '1A(P)(RHF)': '1 seat + ONE arm (right) — Power Recliner (electric)',
  '1A(R)(LHF)': '1 seat + ONE arm (left) — Manual Recliner',
  '1A(R)(RHF)': '1 seat + ONE arm (right) — Manual Recliner',
  '1NA(P)':     '1 seat, NO arms — Power Recliner (electric)',
  '1NA(R)':     '1 seat, NO arms — Manual Recliner',
  // ── Console variants ────────────────────────────────────────────────
  // Commander 2026-05-28: "console 包布的就叫 Console；上面是木的盖那个叫
  // Console/WC". Two distinct codes with different art.
  Console:         'Console — fabric-wrapped console with cup holders',
  'Console/WC':    'Console/WC — wood lid + fabric body, with cup holders',

  // ── 2-Seaters ──────────────────────────────────────────────────────
  '2S':     '2 seats, arms on BOTH sides',
  '2A(LHF)': '2 seats, ONE arm (left)',
  '2A(RHF)': '2 seats, ONE arm (right)',
  '2B(LHF)': '2 seats — LEFT is Seat Cushion (bench), no arm on the right',
  '2B(RHF)': '2 seats — RIGHT is Seat Cushion (bench), no arm on the left',
  '2NA':    '2 seats, NO arms',

  // ── Corner + Accessories ──────────────────────────────────────────
  CNR:     'Corner piece — 90° L-shape connector',
  'WC-45': 'Console (Wood, 45cm) — divider/storage between two seats',
  STOOL:   'Ottoman / stool',
};

// Extra modules NOT in SOFA_MODULES (the Console/WC alias the shared lib
// doesn't model directly). Hand-mapped here so the Maintenance UI gets
// full coverage. Keys are the CANONICAL code (parens form); the value is
// the SVG filename stem under apps/backend/public/sofa-modules/.
const EXTRA_MODULE_IMAGE_BY_NORM: Record<string, string> = {
  // Console = fabric-wrapped (no wood lid). Console/WC = wood lid + fabric body.
  // Commander 2026-05-28 split the original "Console" into 2 codes — the
  // existing SVG (wood lid + fabric) reads as wood at a glance, so it moves
  // to Console-WC; a new fabric-only design lives at Console.
  Console:       'Console',
  // Legacy dash input 'Console-WC' canonicalizes to 'Console(WC)'.
  'Console(WC)': 'Console-WC',
  // normalizeCompartmentCode doesn't touch '/' so commander's raw "Console/WC"
  // input falls through to this key directly (not via canonicalization).
  'Console/WC':  'Console-WC',
};

// Resolve the seeded default for one compartment code. UI surfaces this
// when the stored meta has no value of its own — commander overrides
// land in sofaCompartmentMeta on Save.
const seedCompartmentMeta = (code: string): CompartmentMeta => {
  const norm = normalizeCompartmentCode(code);
  const mod  = SOFA_MODULE_BY_NORM_ID.get(norm);
  // Every sofa module now has a unified hand-drawn SVG plan view
  // (commander 2026-05-27 "你没有统一怎么行呢"). The previous mix of POS PNGs
  // + bespoke SVGs for 1B/2B/CNR was visually inconsistent at the size the
  // Maintenance list renders them — all module + preset designs were
  // redrawn to the same 3-tone flat style (cream body / medium-tan
  // backrest / darkest-tan armrest, dashed seat seams, no labels).
  if (mod) {
    return {
      imageKey:    `sofa-modules/${mod.id}.svg`,
      description: COMPARTMENT_DESCRIPTION_OVERRIDE[mod.id] ?? mod.label,
      // SOFA_MODULES carries no base price — POS reads pricing from
      // product_compartments per Model. Default to 0 here; commander can
      // type the back-office default into the input.
      defaultPriceCenti: 0,
    };
  }
  // Fallback for codes NOT in SOFA_MODULES (the Console/WC alias). These
  // have bespoke SVGs hand-drawn to the same style.
  const extraStem = EXTRA_MODULE_IMAGE_BY_NORM[code.trim()] ?? EXTRA_MODULE_IMAGE_BY_NORM[norm];
  if (extraStem) {
    const desc =
      COMPARTMENT_DESCRIPTION_OVERRIDE[code] ??
      COMPARTMENT_DESCRIPTION_OVERRIDE[norm] ??
      undefined;
    return {
      imageKey:    `sofa-modules/${extraStem}.svg`,
      description: desc,
      defaultPriceCenti: 0,
    };
  }
  return {};
};

// Merge stored override on top of the seed. Empty/undefined fields on
// the override fall back to the seed value.
const resolveCompartmentMeta = (
  code: string,
  stored: CompartmentMeta | undefined,
): CompartmentMeta => {
  const seed = seedCompartmentMeta(code);
  return {
    imageKey:          stored?.imageKey          ?? seed.imageKey,
    description:       stored?.description       ?? seed.description,
    defaultPriceCenti: stored?.defaultPriceCenti ?? seed.defaultPriceCenti,
  };
};

const formatRmFromCenti = (centi: number | undefined): string => {
  const n = centi ?? 0;
  return (n / 100).toFixed(2);
};

const parseRmToCenti = (rm: string): number => {
  const n = Number(rm);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
};

/* PR — Commander 2026-05-28: resolve the per-compartment image source.
 * Three cases:
 *   1) imageKey starts with `sofa-compartments/` — uploaded via the API.
 *      Render via the Worker proxy (`{API}/maintenance-config/sofa-compartments/{code}/photo/{key}`)
 *      so the auth-free public route streams the R2 object.
 *   2) imageKey starts with `sofa-modules/` — legacy bundled SVG, render
 *      from /public.
 *   3) imageKey is an http(s) URL — render directly. */
const SOFA_COMPARTMENT_API_PREFIX = 'sofa-compartments/';
const resolveCompartmentImageSrc = (
  code: string,
  imageKey: string | undefined,
): string | null => {
  if (!imageKey) return null;
  if (/^https?:\/\//i.test(imageKey)) return imageKey;
  if (imageKey.startsWith(SOFA_COMPARTMENT_API_PREFIX)) {
    const API = (import.meta.env.VITE_API_URL ?? '') as string;
    return `${API}/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo/${encodeURIComponent(imageKey)}`;
  }
  // Legacy bundled SVG / PNG from /public.
  return `/${imageKey}`;
};

const SofaCompartmentsList = ({
  config,
  editMode,
  onChange,
  dragRowProps,
  draftValue,
  setDraftValue,
}: {
  config: MaintenanceConfig;
  editMode: boolean;
  onChange: (next: MaintenanceConfig) => void;
  dragRowProps: (i: number) => HTMLAttributes<HTMLDivElement>;
  draftValue: string;
  setDraftValue: (v: string) => void;
}) => {
  const items = config.sofaCompartments ?? [];
  const meta  = config.sofaCompartmentMeta ?? {};
  /* PR — Commander 2026-05-28: per-row photo upload + delete. Always
   * available (not gated by edit mode) because the API writes the imageKey
   * directly to maintenance_config_history without going through the draft
   * → save cycle. uploadingCode tracks which row is mid-upload so we can
   * show a "saving…" hint on the right thumbnail. */
  const uploadPhoto = useUploadSofaCompartmentPhoto();
  const deletePhoto = useDeleteSofaCompartmentPhoto();
  const [uploadingCode, setUploadingCode] = useState<string | null>(null);

  const writeMeta = (code: string, patch: Partial<CompartmentMeta>) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const m    = next.sofaCompartmentMeta ?? {};
    const cur  = m[code] ?? {};
    m[code] = { ...cur, ...patch };
    next.sofaCompartmentMeta = m;
    onChange(next);
  };

  const removeAt = (idx: number) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr  = next.sofaCompartments ?? [];
    arr.splice(idx, 1);
    next.sofaCompartments = arr;
    onChange(next);
  };

  const addItem = () => {
    const v = draftValue.trim();
    if (!v) return;
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr  = next.sofaCompartments ?? [];
    arr.push(v);
    next.sofaCompartments = arr;
    onChange(next);
    setDraftValue('');
  };

  const updateCode = (idx: number, newVal: string) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr  = next.sofaCompartments ?? [];
    const old  = arr[idx];
    arr[idx]   = newVal;
    next.sofaCompartments = arr;
    // Migrate the meta key alongside the code rename so the override
    // doesn't get orphaned. If the new code already has meta, leave it.
    if (old && old !== newVal) {
      const m = next.sofaCompartmentMeta ?? {};
      if (m[old] && !m[newVal]) {
        m[newVal] = m[old]!;
        delete m[old];
        next.sofaCompartmentMeta = m;
      }
    }
    onChange(next);
  };

  return (
    <div className={styles.maintList}>
      {items.map((code, i) => {
        const resolved = resolveCompartmentMeta(code, meta[code]);
        const stored   = meta[code];
        const hasImage = Boolean(resolved.imageKey);
        return (
          <div
            key={`${code}-${i}`}
            className={styles.maintRow}
            {...dragRowProps(i)}
            style={{
              ...(dragRowProps(i).style ?? {}),
              gridTemplateColumns: '32px 32px 56px 1fr auto auto',
              gap: 'var(--space-3)',
              alignItems: 'center',
            }}
          >
            <button type="button" className={styles.maintRowIcon} title="History">
              <History {...ICON_PROPS} />
            </button>
            <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>
              {i + 1}
            </span>
            {/* 48px thumbnail — click to upload, × to delete (when uploaded).
                Uploads land in maintenance_config_history.config.sofaCompartmentMeta
                via the Worker (no draft/save cycle — direct mutation). The
                legacy bundled SVGs (imageKey starts with `sofa-modules/`) are
                not deletable since they're shipped in /public; commander
                replaces them by uploading a new R2 photo, which the resolver
                prefers automatically. */}
            {(() => {
              const isUploaded = (resolved.imageKey ?? '').startsWith(SOFA_COMPARTMENT_API_PREFIX);
              const isUploading = uploadingCode === code;
              const src = resolveCompartmentImageSrc(code, resolved.imageKey);
              return (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    background: hasImage ? 'var(--c-paper)' : 'var(--c-cream-2, #EFEAE0)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                    opacity: isUploading ? 0.5 : 1,
                  }}
                  title={
                    isUploading
                      ? 'Uploading…'
                      : hasImage
                        ? `${resolved.imageKey} — click to replace${isUploaded ? ' · right-click / × to remove' : ''}`
                        : 'Click to upload a photo'
                  }
                  onContextMenu={(e) => {
                    // Right-click on an uploaded photo = delete (matches
                    // commander's "Right-click or × → delete" spec).
                    if (!isUploaded || isUploading) return;
                    e.preventDefault();
                    // eslint-disable-next-line no-alert
                    if (!confirm(`Remove uploaded photo for ${code}?`)) return;
                    deletePhoto.mutate(code);
                  }}
                >
                  <label
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: isUploading ? 'wait' : 'pointer',
                    }}
                  >
                    {hasImage && src ? (
                      <img
                        src={src}
                        alt={code}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span style={{ fontSize: 'var(--fs-10)', color: 'var(--fg-muted)' }}>+ photo</span>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      style={{ display: 'none' }}
                      disabled={isUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Reset the input so re-selecting the same file fires onChange.
                        e.target.value = '';
                        if (!file) return;
                        setUploadingCode(code);
                        uploadPhoto.mutate({ code, file }, {
                          onSettled: () => setUploadingCode(null),
                          onError: (err) => {
                            // eslint-disable-next-line no-alert
                            alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
                          },
                        });
                      }}
                    />
                  </label>
                  {isUploaded && !isUploading && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // eslint-disable-next-line no-alert
                        if (!confirm(`Remove uploaded photo for ${code}?`)) return;
                        deletePhoto.mutate(code);
                      }}
                      title="Remove uploaded photo"
                      aria-label={`Remove photo for ${code}`}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: 'var(--c-festive-b, #B8331F)',
                        color: 'white',
                        border: '1px solid var(--c-paper)',
                        fontSize: 10,
                        lineHeight: '14px',
                        padding: 0,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Code + description column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              {editMode ? (
                <>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => updateCode(i, e.target.value)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-14)',
                      fontWeight: 600,
                      background: 'var(--c-cream)',
                      border: '1px solid var(--c-orange)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      outline: 'none',
                      width: 110,
                    }}
                    title="Compartment code (e.g. 1A(LHF))"
                  />
                  <input
                    type="text"
                    placeholder="Description (e.g. 1-Sitter Left-hand facing)"
                    value={stored?.description ?? resolved.description ?? ''}
                    onChange={(e) => writeMeta(code, { description: e.target.value })}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-13)',
                      background: 'var(--c-cream)',
                      border: '1px solid var(--line-strong)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      outline: 'none',
                      width: '100%',
                      maxWidth: 360,
                    }}
                  />
                </>
              ) : (
                <>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-14)',
                      fontWeight: 600,
                      color: 'var(--c-ink)',
                    }}
                  >
                    {code}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-13)',
                      color: resolved.description ? 'var(--fg-soft)' : 'var(--fg-muted)',
                    }}
                  >
                    {resolved.description ?? '(no design — leave blank)'}
                  </span>
                </>
              )}
            </div>
            {/* Default price column (RM, edits in centi) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 120,
                justifyContent: 'flex-end',
              }}
            >
              <span className={styles.maintRowRmPrefix}>RM</span>
              {editMode ? (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formatRmFromCenti(stored?.defaultPriceCenti ?? resolved.defaultPriceCenti)}
                  onChange={(e) => writeMeta(code, { defaultPriceCenti: parseRmToCenti(e.target.value) })}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-14)',
                    background: 'var(--c-cream)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 8px',
                    outline: 'none',
                    width: 90,
                    textAlign: 'right',
                  }}
                />
              ) : (
                <span
                  className={`${styles.maintRowPrice} ${
                    (resolved.defaultPriceCenti ?? 0) === 0 ? styles.maintRowPriceMuted : ''
                  }`}
                  style={{ minWidth: 0 }}
                >
                  {formatRmFromCenti(resolved.defaultPriceCenti)}
                </span>
              )}
            </div>
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
        );
      })}

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
            placeholder="New compartment code (e.g. 1A(LHF))"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            style={{
              fontFamily: 'var(--font-mono)',
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
};

/* ─── Sofa Quick Presets — module-composition shortcuts (Commander 2026-05-28)
 *
 * Each row: drag handle · label input · modules chip-selector · default tier
 * dropdown · active toggle · delete. The modules chip pool reads from
 * config.sofaCompartments (the master list of compartment codes), so when
 * commander adds a new compartment it becomes available as a preset option
 * automatically. Clicking a chip in the picker toggles membership; selected
 * chips appear in order at the top of the row.
 *
 * Display semantics: the list shown here is the override array as-stored.
 * If the user hasn't seeded anything yet, we surface the DEFAULT_SOFA_QUICK_PRESETS
 * (read-only, watermark style) so commander knows what the historical defaults
 * look like — but the first edit lifts them into the real editable list. */
const SofaQuickPresetsList = ({
  config,
  editMode,
  onChange,
  dragRowProps,
}: {
  config: MaintenanceConfig;
  editMode: boolean;
  onChange: (next: MaintenanceConfig) => void;
  dragRowProps: (i: number) => HTMLAttributes<HTMLDivElement>;
}) => {
  /* When the override is absent, surface the defaults as the working list so
     commander can edit them inline. Save persists whatever's in the array. */
  const stored = config.sofaQuickPresets;
  const items: SofaQuickPreset[] = stored && stored.length > 0
    ? stored
    : resolveSofaQuickPresets(undefined);
  const isUsingFallback = !stored || stored.length === 0;

  /* Master compartment pool — drives the modules chip picker. Includes the
     dash-form codes from sofaCompartments (commander's master pool); if
     empty we fall back to SOFA_MODULES so the picker still works on day 1. */
  const compartmentPool: string[] = (config.sofaCompartments && config.sofaCompartments.length > 0)
    ? config.sofaCompartments
    : SOFA_MODULES.map((m) => m.id);

  const writeAll = (next: SofaQuickPreset[]) => {
    const cfg = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    cfg.sofaQuickPresets = next;
    onChange(cfg);
  };

  const updateAt = (idx: number, patch: Partial<SofaQuickPreset>) => {
    const next = items.map((p, i) => i === idx ? { ...p, ...patch } : p);
    writeAll(next);
  };

  const removeAt = (idx: number) => {
    if (!confirm(`Remove preset "${items[idx]?.label ?? '?'}"? (Existing combos with this preset_id keep working.)`)) return;
    writeAll(items.filter((_, i) => i !== idx));
  };

  const toggleModule = (idx: number, code: string) => {
    const cur = items[idx]?.modules ?? [];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    updateAt(idx, { modules: next });
  };

  const addPreset = () => {
    /* Seed a blank row; commander fills in id/label/modules. The id default
       picks the next "P<N>" so two consecutive adds don't collide. */
    const usedIds = new Set(items.map((p) => p.id));
    let n = items.length + 1;
    while (usedIds.has(`P${n}`)) n += 1;
    const newRow: SofaQuickPreset = {
      id: `P${n}`,
      label: 'New preset',
      modules: [],
      active: true,
    };
    writeAll([...items, newRow]);
  };

  return (
    <div className={styles.maintList}>
      {isUsingFallback && editMode && (
        <div className={styles.bannerWarn} style={{ marginBottom: 8 }}>
          Showing the default 11-entry list. Hit Save to lift these into the
          stored config and start customising — existing combos that reference
          preset_id will keep resolving against the same ids.
        </div>
      )}
      {items.map((p, i) => (
        <div
          key={`${p.id}-${i}`}
          className={styles.maintRow}
          {...dragRowProps(i)}
          style={{
            ...(dragRowProps(i).style ?? {}),
            gridTemplateColumns: '32px 32px 100px 1fr 110px auto auto',
            gap: 'var(--space-3)',
            alignItems: 'center',
          }}
        >
          <button type="button" className={styles.maintRowIcon} title="History">
            <History {...ICON_PROPS} />
          </button>
          <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>
            {i + 1}
          </span>
          {/* id input — stable key referenced by combo rules */}
          {editMode ? (
            <input
              type="text"
              value={p.id}
              onChange={(e) => updateAt(i, { id: e.target.value })}
              placeholder="ID"
              title="Stable key — referenced by combo rules. Don't rename after combos exist."
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                fontWeight: 600,
                background: 'var(--c-cream)',
                border: '1px solid var(--c-orange)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 6px',
                outline: 'none',
                width: '100%',
              }}
            />
          ) : (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-soft)',
            }}>
              {p.id}
            </span>
          )}
          {/* label + modules — stack vertically inside the flexible main column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            {editMode ? (
              <input
                type="text"
                value={p.label}
                onChange={(e) => updateAt(i, { label: e.target.value })}
                placeholder="Label (e.g. 1-Seater)"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-14)',
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
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-14)',
                fontWeight: 600,
                color: 'var(--c-ink)',
              }}>
                {p.label}
              </span>
            )}
            {/* modules chip rail — selected on top, available below in edit mode */}
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-11)',
              color: 'var(--fg-soft)',
            }}>
              {p.modules.length === 0 ? (
                <span style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                  No modules selected
                </span>
              ) : (
                p.modules.join(' + ')
              )}
            </div>
            {editMode && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 4,
                padding: 6,
                background: 'var(--c-paper)',
                border: '1px dashed var(--line)',
                borderRadius: 'var(--radius-sm)',
              }}>
                {compartmentPool.map((code) => {
                  const on = p.modules.includes(code);
                  return (
                    <button
                      type="button"
                      key={code}
                      onClick={() => toggleModule(i, code)}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-11)',
                        fontWeight: 600,
                        background: on ? 'var(--c-orange, #c47b2f)' : 'var(--c-paper)',
                        color: on ? 'var(--c-paper, #fff)' : 'var(--c-ink)',
                        border: `1px solid ${on ? 'var(--c-orange, #c47b2f)' : 'var(--line-strong)'}`,
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px 8px',
                        cursor: 'pointer',
                      }}
                      title={on ? 'Click to remove' : 'Click to add'}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* default tier select */}
          {editMode ? (
            <select
              value={p.defaultTier ?? ''}
              onChange={(e) => updateAt(i, { defaultTier: (e.target.value || undefined) as SofaPriceTier | undefined })}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-12)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 6px',
                outline: 'none',
              }}
              title="Default tier applied when this preset is used in the New Combo dialog"
            >
              <option value="">— Any tier —</option>
              <option value="PRICE_1">PRICE_1</option>
              <option value="PRICE_2">PRICE_2</option>
              <option value="PRICE_3">PRICE_3</option>
            </select>
          ) : (
            <span style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-11)',
              color: 'var(--fg-soft)',
            }}>
              {p.defaultTier ?? '—'}
            </span>
          )}
          {/* active toggle */}
          {editMode ? (
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)',
              color: 'var(--fg-soft)', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={p.active !== false}
                onChange={(e) => updateAt(i, { active: e.target.checked })}
                title="Inactive presets stay in history but don't show in pickers"
              />
              Active
            </label>
          ) : (
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)',
              color: p.active === false ? 'var(--fg-muted)' : 'var(--c-green, #1a7a3a)',
            }}>
              {p.active === false ? 'Inactive' : 'Active'}
            </span>
          )}
          {editMode ? (
            <button
              type="button"
              className={styles.maintRowIcon}
              title="Remove preset"
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
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
            color: 'var(--fg-soft)',
          }}>
            Append a blank preset row — fill in ID, label, and pick modules from the chip rail.
          </span>
          <Button variant="primary" size="sm" onClick={addPreset}>
            <Plus {...ICON_PROPS} />
            <span>Add preset</span>
          </Button>
        </div>
      )}
    </div>
  );
};

const MaintenanceList = ({
  listKey,
  config,
  editMode,
  onChange,
  priced,
  singleCostColumn = false,
}: {
  listKey: MaintenanceListKey;
  config: MaintenanceConfig;
  editMode: boolean;
  onChange: (next: MaintenanceConfig) => void;
  priced: boolean;
  singleCostColumn?: boolean;
}) => {
  // Empty draft state for the "add new" row at the bottom of the list when
  // edit mode is on. Kept local so toggling tabs cancels in-flight adds.
  const [draftValue, setDraftValue] = useState('');
  const [draftPrice, setDraftPrice] = useState('0.00');
  /* PR #216 — Commander 2026-05-27: parallel cost-side input. Operation
     enters the estimated raw cost alongside the selling price; the value
     persists into PricedOption.costSen and feeds computeMfgLineCost(). */
  const [draftCost, setDraftCost] = useState('0.00');

  /* Commander 2026-05-27: "Maintenance 也要有 Sort 的功能" — drag-and-drop
     row reorder when editMode. Uses native HTML5 drag API (no library).
     dragIdx tracks the row currently being dragged; on drop we splice it
     to the new index and emit onChange so the parent's draft sees the
     new order. Save persists the array order naturally. */
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const moveAt = (from: number, to: number) => {
    if (from === to) return;
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr = ((next as unknown as Record<string, unknown>)[listKey] as unknown[] | undefined) ?? [];
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    (next as Record<string, unknown>)[listKey] = arr;
    onChange(next);
  };
  /* Per-row props factory — returns the draggable handlers + visual hint.
     Only active in edit mode; otherwise rows are static. */
  const dragRowProps = (i: number): HTMLAttributes<HTMLDivElement> => {
    if (!editMode) return {};
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragIdx(i);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to start a drag
        try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* noop */ }
      },
      onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
      onDrop: (e) => {
        e.preventDefault();
        if (dragIdx === null) return;
        moveAt(dragIdx, i);
        setDragIdx(null);
      },
      onDragEnd: () => setDragIdx(null),
      style: dragIdx === i ? { opacity: 0.5 } : undefined,
      title: 'Drag to reorder',
    };
  };

  if (listKey === 'fabrics') {
    return <FabricsMaintenancePanel />;
  }

  // PR #74 — Code Format tab removed (Commander 2026-05-26: preset only).
  // The CodeFormatPanel component is kept in the file dead-code below in
  // case we ever want to re-expose it; the API's hardcoded templates take
  // over when the cfg.{category}CodeFormat / NameFormat fields are blank.

  // ── String[] tabs (gaps, sofaSizes, + PR #50 pool keys) ──────────────
  // Defaulting to [] avoids the "Cannot read properties of undefined
  // (reading 'map')" crash when an older maintenance_config row doesn't
  // carry the new pool keys yet. Editing then saving will materialise the
  // key in the JSONB blob.
  // PR #220 (Commander 2026-05-27) — Sofa Compartments gets its own renderer
  // with image preview + description + default price, ported from the POS
  // module catalogue (SOFA_MODULES). Falls through to the generic string[]
  // branch below for every other pool key.
  if (listKey === 'sofaCompartments') {
    return (
      <SofaCompartmentsList
        config={config}
        editMode={editMode}
        onChange={onChange}
        dragRowProps={dragRowProps}
        draftValue={draftValue}
        setDraftValue={setDraftValue}
      />
    );
  }

  if (listKey === 'sofaQuickPresets') {
    return (
      <SofaQuickPresetsList
        config={config}
        editMode={editMode}
        onChange={onChange}
        dragRowProps={dragRowProps}
      />
    );
  }

  if (
    listKey === 'gaps'
    || listKey === 'sofaSizes'
    || listKey === 'bedframeSizes'
    || listKey === 'mattressSizes'
  ) {
    const items = (config[listKey] as string[] | undefined) ?? [];

    const removeAt = (idx: number) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      const arr = (next[listKey] as string[] | undefined) ?? [];
      arr.splice(idx, 1);
      (next as Record<string, unknown>)[listKey] = arr;
      onChange(next);
    };

    const addItem = () => {
      const v = draftValue.trim();
      if (!v) return;
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      // Same defaulting story — the new pool keys (PR #50) may not exist on
      // old maintenance_config rows yet.
      const arr = (next[listKey] as string[] | undefined) ?? [];
      arr.push(v);
      (next as Record<string, unknown>)[listKey] = arr;
      onChange(next);
      setDraftValue('');
    };

    /* PR #40 — Commander 2026-05-26: existing rows must be editable, not
       just deletable. The string[] flow (gaps / sofaSizes) was missing
       inline edit — added below. */
    const updateAt = (idx: number, newVal: string) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      const arr = (next[listKey] as string[] | undefined) ?? [];
      arr[idx] = newVal;
      (next as Record<string, unknown>)[listKey] = arr;
      onChange(next);
    };

    // PR #92 — Commander 2026-05-26: "King, 6FT, 183 那些，如果我要改的话，
    // 怎么样去改呢？" For bedframe/mattress sizes, editMode now exposes 3
    // columns: code | label | dimensions. The code stays in the
    // bedframeSizes string[]; label + dimensions land in a parallel
    // sizeLabels override keyed by code. Read path goes through
    // resolveSizeInfo() so the rest of the app picks the override up.
    const isSizeRow = listKey === 'bedframeSizes' || listKey === 'mattressSizes';
    const updateLabel = (code: string, field: 'label' | 'dimensions', val: string) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      const labels = (next.sizeLabels ?? {}) as Record<string, { label?: string; dimensions?: string }>;
      const cur    = labels[code] ?? {};
      labels[code] = { ...cur, [field]: val };
      next.sizeLabels = labels;
      onChange(next);
    };
    return (
      <div className={styles.maintList}>
        {items.map((v, i) => {
          const labelOv = config.sizeLabels?.[v];
          const resolved = isSizeRow ? resolveSizeInfo(v, config) : null;
          return (
          <div key={`${v}-${i}`} className={styles.maintRow} {...dragRowProps(i)}>
            <button type="button" className={styles.maintRowIcon} title="History">
              <History {...ICON_PROPS} />
            </button>
            <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>{i + 1}</span>
            <span className={styles.maintRowValue}>
              {editMode ? (
                isSizeRow ? (
                  // PR #92 — Inline 3-input editor (code · label · dimensions)
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={v}
                      onChange={(e) => updateAt(i, e.target.value)}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-14)',
                        fontWeight: 600,
                        background: 'var(--c-cream)',
                        border: '1px solid var(--c-orange)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        outline: 'none',
                        width: 80,
                      }}
                      title="Size code (e.g. K)"
                    />
                    <span style={{ color: 'var(--fg-muted)', fontWeight: 700 }}>·</span>
                    <input
                      type="text"
                      placeholder="Label e.g. 6FT"
                      value={labelOv?.label ?? resolved?.label ?? ''}
                      onChange={(e) => updateLabel(v, 'label', e.target.value)}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--fs-14)',
                        background: 'var(--c-cream)',
                        border: '1px solid var(--line-strong)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        outline: 'none',
                        width: 110,
                      }}
                    />
                    <span style={{ color: 'var(--fg-muted)', fontWeight: 700 }}>·</span>
                    <input
                      type="text"
                      placeholder="Dimensions e.g. 183X190CM"
                      value={labelOv?.dimensions ?? resolved?.dim ?? ''}
                      onChange={(e) => updateLabel(v, 'dimensions', e.target.value)}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--fs-14)',
                        background: 'var(--c-cream)',
                        border: '1px solid var(--line-strong)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        outline: 'none',
                        width: 170,
                      }}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => updateAt(i, e.target.value)}
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
                )
              ) : (
                /* PR #77 — enrich bedframe/mattress size codes with their
                   imperial label + cm dimensions so the bare "K" row reads
                   as "K · 6FT · 183x190CM". String stored unchanged — only
                   display is enriched. Other list types (gaps, sofa
                   compartments, sofa seat sizes) fall back to raw value.
                   PR #92 — display path now consults sizeLabels override. */
                isSizeRow
                  ? formatSizeRichWithCfg(v, config)
                  : v
              )}
            </span>
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
          );
        })}

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
  // Same defaulting as the string[] branch — old maintenance_config rows
  // may not yet carry every key the UI now lists.
  const items = (config[listKey] as PricedOption[] | undefined) ?? [];

  const removeAt = (idx: number) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr = (next[listKey] as PricedOption[] | undefined) ?? [];
    arr.splice(idx, 1);
    (next as Record<string, unknown>)[listKey] = arr;
    onChange(next);
  };

  const addItem = () => {
    const v = draftValue.trim();
    if (!v) return;
    const priceSen = Math.round((Number(draftPrice) || 0) * 100);
    const costSenRaw = Math.round((Number(draftCost) || 0) * 100);
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr = (next[listKey] as PricedOption[] | undefined) ?? [];
    // costSen is opt-in — store only when commander typed a non-zero value
    // so old rows stay shape-identical (avoids dirty diffs on save).
    const row: PricedOption = costSenRaw > 0
      ? { value: v, priceSen, costSen: costSenRaw }
      : { value: v, priceSen };
    arr.push(row);
    (next as Record<string, unknown>)[listKey] = arr;
    onChange(next);
    setDraftValue('');
    setDraftPrice('0.00');
    setDraftCost('0.00');
  };

  return (
    <div className={styles.maintList}>
      {items.map((opt, i) => (
        <div key={`${opt.value}-${i}`} className={styles.maintRow} {...dragRowProps(i)}>
          <button type="button" className={styles.maintRowIcon} title="History">
            <History {...ICON_PROPS} />
          </button>
          <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>{i + 1}</span>
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
              <span className={styles.maintRowRmPrefix}>{singleCostColumn ? 'Cost' : 'RM'}</span>
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
            {/* PR #216 — parallel cost column. Edit mode renders an input;
                read mode appends "· RM 80.00 cost" when costSen is set,
                otherwise stays silent so old rows look unchanged.
                singleCostColumn (Supplier Detail) hides this whole column —
                there the priceSen "Cost" column already IS our cost. */}
            {!singleCostColumn && (editMode ? (
              <span className={styles.maintRowPrice} title="Estimated raw cost (Operation)">
                <span className={styles.maintRowRmPrefix}>COST RM</span>
                <input
                  type="number"
                  step="0.01"
                  value={((opt.costSen ?? 0) / 100).toFixed(2)}
                  onChange={(e) => {
                    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
                    const list = next[listKey] as PricedOption[];
                    const sen = Math.round(Number(e.target.value) * 100);
                    if (sen > 0) {
                      list[i]!.costSen = sen;
                    } else {
                      delete list[i]!.costSen;
                    }
                    onChange(next);
                  }}
                  style={{
                    width: 90,
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-14)',
                    background: 'var(--c-cream)',
                    border: '1px dashed var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 8px',
                    outline: 'none',
                  }}
                />
              </span>
            ) : (
              opt.costSen != null && opt.costSen > 0 ? (
                <span className={styles.maintRowPrice} style={{ color: 'var(--fg-muted)' }}>
                  <span className={styles.maintRowRmPrefix}>RM</span>
                  {(opt.costSen / 100).toFixed(2)}
                  <span style={{ marginLeft: 4, fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)', letterSpacing: '0.08em' }}>COST</span>
                </span>
              ) : null
            ))}
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
            <span className={styles.maintRowRmPrefix}>{singleCostColumn ? 'Cost' : 'RM'}</span>
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
            {/* PR #216 — Operation-side cost input on the add-new row.
                singleCostColumn (Supplier Detail) hides it for parity with
                the per-row column. */}
            {!singleCostColumn && (
              <>
                <span className={styles.maintRowRmPrefix}>COST RM</span>
                <input
                  type="number"
                  step="0.01"
                  value={draftCost}
                  onChange={(e) => setDraftCost(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
                  title="Estimated raw cost (Operation)"
                  style={{
                    width: 90,
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-14)',
                    background: 'var(--c-cream)',
                    border: '1px dashed var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 8px',
                    outline: 'none',
                  }}
                />
              </>
            )}
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

/* ═══════════════════════════════════════════════════════════════════════
   PR #72 — Per-category code/name format editor (DEAD CODE as of PR #74).
   Commander 2026-05-26: revert to preset-only templates — the hardcoded
   ones in apps/api/src/routes/product-models.ts §generate are the source
   of truth. UI editor below kept as dead code in case we re-expose it;
   sidebar no longer routes to it (see MaintenanceList). The
   {category}CodeFormat / NameFormat columns on the JSONB blob are now
   always read as blank → API template fallback kicks in.
   ════════════════════════════════════════════════════════════════════════ */

type CodeFormatKey = 'bedframeFormat' | 'sofaFormat' | 'mattressFormat';

interface FormatFieldMap {
  codeKey:    keyof MaintenanceConfig;
  nameKey:    keyof MaintenanceConfig;
  codeDefault: string;
  nameDefault: string;
  sample:     Record<string, string>;
  placeholderHint: string;
}

const FORMAT_FIELDS: Record<CodeFormatKey, FormatFieldMap> = {
  bedframeFormat: {
    codeKey:     'bedframeCodeFormat',
    nameKey:     'bedframeNameFormat',
    codeDefault: '{model_code}-({size})',
    // PR #100 — include {model_name} so output matches mattress convention
    // (e.g. "TRION BEDFRAME (6FT) (183X190CM)"). Mirrors DEFAULT_FORMATS
    // in ProductModelDetail.tsx and API §BEDFRAME branch.
    nameDefault: '{branding} {model_name} BEDFRAME ({size_label}) ({dimensions})',
    sample: {
      branding:    'HILTON',
      model_code:  '1003',
      model_name:  'TRION',
      size:        'K',
      size_label:  '6FT',
      dimensions:  '183X190CM',
    },
    placeholderHint: '{branding}, {model_code}, {model_name}, {size}, {size_label}, {dimensions}',
  },
  sofaFormat: {
    codeKey:     'sofaCodeFormat',
    nameKey:     'sofaNameFormat',
    codeDefault: '{model_code}-{compartment}',
    nameDefault: '{model_name} {compartment}',
    sample: {
      branding:    'HOUZS',
      model_code:  '5530',
      model_name:  'SOFA 5530',
      compartment: '1A(LHF)',
    },
    placeholderHint: '{branding}, {model_code}, {model_name}, {compartment}',
  },
  mattressFormat: {
    codeKey:     'mattressCodeFormat',
    nameKey:     'mattressNameFormat',
    codeDefault: '{model_code} MATT ({size})',
    nameDefault: '{model_name} ({width}x{length}x{thickness}CM)',
    sample: {
      branding:    '2990S',
      model_code:  '2990-NF AKKA-FIRM',
      model_name:  '2990 AKKA-FIRM MATTRESS',
      size:        'K',
      size_label:  '6FT',
      width:       '183',
      length:      '190',
      thickness:   '31',
    },
    placeholderHint: '{branding}, {model_code}, {model_name}, {size}, {size_label}, {width}, {length}, {thickness}',
  },
};

function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_match, k) => vars[k] ?? '');
}

const CodeFormatPanel = ({
  listKey, config, editMode, onChange,
}: {
  listKey: CodeFormatKey;
  config: MaintenanceConfig;
  editMode: boolean;
  onChange: (next: MaintenanceConfig) => void;
}) => {
  const f = FORMAT_FIELDS[listKey];
  const codeVal = (config[f.codeKey] as string | undefined) ?? '';
  const nameVal = (config[f.nameKey] as string | undefined) ?? '';

  const codeEffective = codeVal.trim() || f.codeDefault;
  const nameEffective = nameVal.trim() || f.nameDefault;

  const exampleCode = substitute(codeEffective, f.sample);
  const exampleName = substitute(nameEffective, f.sample);

  const update = (key: keyof MaintenanceConfig, value: string) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    (next as Record<string, unknown>)[key] = value;
    onChange(next);
  };

  const inputStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-13)',
    padding: 'var(--space-3) var(--space-4)',
    border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius-sm)',
    background: editMode ? 'var(--c-paper)' : 'var(--c-cream)',
    color: 'var(--fg)',
    width: '100%',
    outline: 'none',
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div className="t-eyebrow" style={{ marginBottom: 4 }}>Code template</div>
        <input
          type="text"
          readOnly={!editMode}
          value={codeVal}
          placeholder={f.codeDefault}
          onChange={(e) => update(f.codeKey, e.target.value)}
          style={inputStyle}
        />
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Default if blank: <code>{f.codeDefault}</code>
        </p>
      </div>

      <div>
        <div className="t-eyebrow" style={{ marginBottom: 4 }}>Name template</div>
        <input
          type="text"
          readOnly={!editMode}
          value={nameVal}
          placeholder={f.nameDefault}
          onChange={(e) => update(f.nameKey, e.target.value)}
          style={inputStyle}
        />
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Default if blank: <code>{f.nameDefault}</code>
        </p>
      </div>

      <div style={{
        background: 'var(--c-cream)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}>
        <div className="t-eyebrow" style={{ marginBottom: 8 }}>Live preview · sample row</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            code
            <code style={{ marginLeft: 12, background: 'var(--c-orange)', color: 'var(--bg)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              {exampleCode}
            </code>
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            name
            <code style={{ marginLeft: 12, background: 'var(--c-orange)', color: 'var(--bg)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              {exampleName}
            </code>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        <strong>Available placeholders:</strong> {f.placeholderHint}
      </div>
    </div>
  );
};

const FabricsMaintenancePanel = () => {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useFabricTrackings({
    search: search.trim() || undefined,
  });
  const rows = data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
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
        {/* PR #43 — Link to Fabric Converter for "+ New Fabric". Same data,
            same edits. Keeping the create modal on one page only to avoid
            duplicate UI state. */}
        <a
          href="/fabric-tracking"
          style={{
            fontSize: 'var(--fs-13)', color: 'var(--c-burnt)',
            textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          <Plus {...ICON_PROPS} />
          <span>New fabric in Fabric Converter →</span>
        </a>
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
  /* 2990 is a trading company — no in-house manufacturing. Production-time
     tracking dropped (was HOOKKA legacy). DB column production_time_minutes
     stays for now but the UI no longer collects it. */
  const [form, setForm] = useState<{
    code: string; name: string; category: Cat;
    description: string; baseModel: string; sizeLabel: string;
    branding: string; fabricColor: string;
    basePrice: string; price1: string; costPrice: string;
    unitM3: string;
  }>({
    code: '', name: '', category: 'BEDFRAME',
    description: '', baseModel: '', sizeLabel: '',
    branding: '', fabricColor: '',
    basePrice: '', price1: '', costPrice: '',
    unitM3: '',
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
            {/* Commander 2026-05-28 — unify fabric/colour term → "Fabrics". Key fabricColor unchanged. */}
            {isSofa && <Field label="Fabrics" value={form.fabricColor} onChange={(v) => set('fabricColor', v)} />}
            <Field label="Description" value={form.description} onChange={(v) => set('description', v)} fullWidth />

            <Field label={isMattress ? 'Price (RM)' : 'Base Price / Price 2 (RM)'}
              value={form.basePrice} onChange={(v) => set('basePrice', v)} type="number" />
            {!isMattress && !isService && (
              <Field label="Price 1 (RM)" value={form.price1} onChange={(v) => set('price1', v)} type="number" />
            )}
            <Field label="Cost Price (RM)" value={form.costPrice} onChange={(v) => set('costPrice', v)} type="number" />
            <Field label="Unit (m³)" value={form.unitM3} onChange={(v) => set('unitM3', v)} type="number" step="0.001" />
            {/* Production Time field removed — 2990 is a trading company (PR-strip-production). */}
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
   PR #38 — ProductSuppliersDrawer
   Double-click a product row to see every supplier that carries it,
   their supplier-side SKU + unit price + lead time. The MAIN supplier
   (used by default on POs) is starred and pinned to the top.
   ════════════════════════════════════════════════════════════════════════ */

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '/');
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};

const fmtRmCenti = (centi: number): string =>
  `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ProductSuppliersDrawer = ({
  row, onClose,
}: { row: MfgProductRow; onClose: () => void }) => {
  const q = useMfgProductSuppliers(row.id);
  const suppliers = q.data?.suppliers ?? [];

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
            <h2 className={styles.drawerTitle}>
              <Truck {...ICON_PROPS} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Suppliers · <span className={styles.codeChip}>{row.code}</span>
            </h2>
            <p style={{ marginTop: 4, fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
              {row.name}{row.description ? ` — ${row.description}` : ''}
            </p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose}>
            <X {...ICON_PROPS} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
          {/* Commander 2026-05-29 — "双击点进去要看到 supplier 和 available 什么
              variant". This drill-in now shows BOTH: the model's allowed variant
              options first, then the suppliers carrying the SKU. */}
          {(() => {
            const ao = row.allowed_options as Record<string, string[] | undefined> | null | undefined;
            const groups: Array<[string, string[]]> = [];
            const push = (label: string, vals?: string[]) => { if (vals && vals.length) groups.push([label, vals]); };
            if (ao) {
              push('Sizes', ao.sizes);
              push('Compartments', ao.compartments);
              push('Divan heights', ao.divan_heights);
              push('Total heights', ao.total_heights);
              push('Leg heights', ao.leg_heights);
              push('Specials', ao.specials);
            }
            return (
              <section style={{ marginBottom: 'var(--space-5)' }}>
                <h3 style={{ fontSize: 'var(--fs-12)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', marginBottom: 'var(--space-2)' }}>
                  Available variants
                </h3>
                {groups.length === 0 ? (
                  <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
                    No variant options configured for this model{row.category ? ` (${row.category})` : ''}.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {groups.map(([label, vals]) => (
                      <div key={label} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ minWidth: 120, fontSize: 'var(--fs-11)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--fg-muted)' }}>{label}</span>
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {vals.map((v) => (
                            <span key={v} className={styles.codeChip} style={{ fontSize: 'var(--fs-12)' }}>{v}</span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })()}

          <h3 style={{ fontSize: 'var(--fs-12)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', marginBottom: 'var(--space-2)' }}>
            Suppliers
          </h3>
          {q.isLoading && (
            <p style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>Loading suppliers…</p>
          )}
          {!q.isLoading && suppliers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--fg-muted)' }}>
              <Truck size={32} strokeWidth={1.5} />
              <div style={{ marginTop: 8 }}>No suppliers carry this product yet.</div>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                Go to Suppliers → Detail → Add Mapping to link a supplier to this SKU.
              </div>
            </div>
          )}
          {!q.isLoading && suppliers.length > 0 && (
            <table className={styles.table} style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Supplier</th>
                  <th>Supplier SKU</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>Lead (d)</th>
                  <th style={{ textAlign: 'right' }}>MOQ</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s: ProductSupplierRow) => (
                  <tr key={s.id} style={{
                    background: s.is_main_supplier ? 'rgba(232, 107, 58, 0.06)' : undefined,
                  }}>
                    <td style={{ textAlign: 'center' }}>
                      {s.is_main_supplier && (
                        <Star size={14} strokeWidth={2} style={{ color: 'var(--c-orange)', fill: 'var(--c-orange)' }} />
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: s.is_main_supplier ? 700 : 400 }}>
                        {s.suppliers?.name ?? '—'}
                      </div>
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                        {s.suppliers?.code ?? ''}{s.suppliers?.phone ? ` · ${s.suppliers.phone}` : ''}
                      </div>
                    </td>
                    <td>
                      {s.supplier_sku
                        ? <span className={styles.codeChip}>{s.supplier_sku}</span>
                        : <span style={{ color: 'var(--fg-muted)' }}>(same as our code)</span>}
                    </td>
                    <td className={styles.numCell}>
                      {fmtRmCenti(s.unit_price_centi)}{s.currency !== 'MYR' ? ` ${s.currency}` : ''}
                    </td>
                    <td className={styles.numCell}>{s.lead_time_days || '—'}</td>
                    <td className={styles.numCell}>{s.moq || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className={styles.drawerFooter}>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginRight: 'auto' }}>
            <Star size={11} strokeWidth={2} style={{ verticalAlign: 'middle', color: 'var(--c-orange)', fill: 'var(--c-orange)' }} />
            {' '}Main supplier — used by default when generating POs.
          </p>
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

// PR #104 — Commander 2026-05-26: "fabric_usage_centi / production_time_minutes
// / fabric_color 全删 不需要这个功能". These manufacturing-specific fields
// were ported in from HOOKKA but don't apply to 2990's retail catalogue;
// dropping them from the CSV export so commander's spreadsheet stays focused.
// Schema columns + API field writers also stripped (apps/api/src/routes/
// mfg-products.ts) so future imports don't resurrect the data.
//
// Sofa per-tier export (Wei Siang) — a sofa carries a price per (size × tier).
// The CSV is LONG form: one row per sofa tier (PRICE_1 / PRICE_2 / PRICE_3),
// with one money column per size. Non-sofa rows leave the size columns blank
// and carry base_price_sen / price1_sen instead. The old cost_price_sen column
// is dropped entirely — it was the zeroing trap on round-trip.


/** Normalize a stored seat height to its bare size token so '28"' matches '28'. */
const normalizeHeight = (h: unknown): string => String(h ?? '').replace('"', '').trim();

/** Fixed leading + trailing columns. The per-size price columns are spliced
 *  in between, derived from the live sofaSizes config at export time. */
const CSV_HEAD_COLS = ['code', 'name', 'category', 'description', 'base_model', 'size_label', 'price_tier'] as const;
const CSV_TAIL_COLS = ['base_price_sen', 'price1_sen', 'unit_m3_milli', 'status', 'branding'] as const;

const priceColForSize = (size: string) => `price_${size}_sen`;

function exportSkusCsv(rows: MfgProductRow[], sofaSizes: string[], tier: SofaPriceTier): void {
  const sizeCols = sofaSizes.map(priceColForSize);
  const columns = [...CSV_HEAD_COLS, ...sizeCols, ...CSV_TAIL_COLS];

  // RFC4180: quote if contains comma, quote, or newline.
  const cell = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines: string[] = [columns.join(',')];

  for (const r of rows) {
    const common: Record<string, unknown> = {
      code:        r.code,
      name:        r.name,
      category:    r.category,
      description: r.description,
      base_model:  r.base_model,
      size_label:  r.size_label,
      unit_m3_milli: r.unit_m3_milli,
      status:      r.status,
      branding:    r.branding,
    };

    const emit = (extra: Record<string, unknown>) => {
      const merged = { ...common, ...extra };
      lines.push(columns.map((c) => cell(merged[c])).join(','));
    };

    if (r.category === 'SOFA') {
      // ONE row per sofa for the CURRENTLY SELECTED tier (the P1/P2/P3 toggle) —
      // matches what the operator filters/edits on screen. Other tiers are left
      // out of this file and preserved on re-import (backend merges by tier).
      const m = new Map<string, number>();
      for (const e of r.seat_height_prices ?? []) {
        if ((e.tier ?? 'PRICE_2') === tier) m.set(normalizeHeight(e.height), e.priceSen);
      }
      const sizeCells: Record<string, unknown> = {};
      for (const size of sofaSizes) {
        const p = m.get(normalizeHeight(size));
        sizeCells[priceColForSize(size)] = p == null ? '' : p;
      }
      emit({ price_tier: tier, ...sizeCells });
    } else {
      // Bedframe / mattress / accessory / service — flat base + price1.
      emit({
        price_tier:     '',
        base_price_sen: r.base_price_sen ?? '',
        price1_sen:     r.price1_sen ?? '',
      });
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `2990s-skus-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Round-trip CSV parser (RFC4180) for the SKU import ───────────────────
 * Generic header-keyed parser: returns one plain object per data row, keyed by
 * the exact header text (lower-cased, trimmed). Handles quoted fields with
 * embedded commas, quotes ("" escape), and CR/LF inside quotes. Strips a
 * leading UTF-8 BOM so a file saved from Excel parses cleanly. (fabric-csv's
 * parseCsv is fabric-specific — it requires a fabric_code column and remaps to
 * fabric apiKeys — so we keep a small local parser here.) */
function parseSkuCsv(text: string): Array<Record<string, string>> {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const grid: string[][] = [];
  let row: string[] = [];
  let cellStr = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cellStr += '"'; i++; continue; }
        inQuotes = false;
      } else {
        cellStr += ch;
      }
      continue;
    }
    if (ch === '"' && cellStr === '') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cellStr); cellStr = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cellStr); grid.push(row); row = []; cellStr = ''; continue; }
    cellStr += ch;
  }
  if (cellStr !== '' || row.length > 0) { row.push(cellStr); grid.push(row); }

  if (grid.length < 1) return [];
  const header = (grid[0] ?? []).map((h) => h.trim().toLowerCase());
  const out: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => c.trim() === '')) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      obj[key] = (cells[c] ?? '').trim();
    }
    out.push(obj);
  }
  return out;
}

const ImportSkusDialog = ({ sofaSizes, onClose }: { sofaSizes: string[]; onClose: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchImportResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const batchImport = useBatchImportMfgProducts();

  const handleFile = async (file: File) => {
    setBusy(true);
    setResult(null);
    setErrorMsg(null);
    try {
      const text = await file.text();
      const parsed = parseSkuCsv(text);
      if (parsed.length === 0) {
        setErrorMsg('That file had no rows. Export a copy first, edit it, then import the same file.');
        setBusy(false);
        return;
      }

      // Group rows by code — a sofa with PRICE_1 / PRICE_2 / PRICE_3 rows
      // becomes ONE product carrying all its size × tier prices.
      const byCode = new Map<string, Array<Record<string, string>>>();
      for (const p of parsed) {
        const code = (p.code ?? '').trim();
        if (!code) continue;
        const list = byCode.get(code);
        if (list) list.push(p); else byCode.set(code, [p]);
      }

      const rows: BatchImportRow[] = [];
      // SKUs skipped because a price row's tier couldn't be recognised — shown
      // to the operator so a mislabelled price is never silently mis-filed.
      const tierErrors: Array<{ code: string; reason: string }> = [];
      for (const [code, group] of byCode) {
        const first = group[0];
        if (!first) continue;
        // A field is only carried when its cell is non-empty, so a blank cell
        // never overwrites existing data on the SKU.
        const has = (v: string | undefined) => v != null && v !== '';
        const out: BatchImportRow = {
          code,
          name:     first.name ?? '',
          category: first.category ?? '',
        };
        if (has(first.description)) out.description = first.description;
        if (has(first.base_model)) out.base_model = first.base_model;
        if (has(first.size_label)) out.size_label = first.size_label;
        if (has(first.status))     out.status = first.status;
        if (has(first.branding))   out.branding = first.branding;

        // base_price_sen / price1_sen — take the first row that filled them.
        const baseRow = group.find((g) => has(g.base_price_sen));
        if (baseRow) out.base_price_sen = Number(baseRow.base_price_sen);
        const p1Row = group.find((g) => has(g.price1_sen));
        if (p1Row) out.price1_sen = Number(p1Row.price1_sen);
        const m3Row = group.find((g) => has(g.unit_m3_milli));
        if (m3Row) out.unit_m3_milli = Number(m3Row.unit_m3_milli);

        // Sofa per-size × per-tier prices, gathered across all of this code's
        // tier rows. A row that carries any price MUST name a recognisable tier
        // (P1/P2/P3) — otherwise the SKU is skipped with a clear reason so a
        // price never lands in the wrong tier.
        const seat: SeatHeightPrice[] = [];
        let tierError: string | null = null;
        for (const g of group) {
          const hasAnyPrice = sofaSizes.some((size) => has(g[`price_${size}_sen`]));
          if (!hasAnyPrice) continue;
          const t = normalizeSofaTier(g.price_tier);
          if (!t) { tierError = (g.price_tier ?? '').trim() || '(blank)'; break; }
          for (const size of sofaSizes) {
            const raw = g[`price_${size}_sen`];
            if (!has(raw)) continue;
            const n = Number(raw);
            if (!Number.isFinite(n)) continue;
            seat.push({ height: size, priceSen: n, tier: t });
          }
        }
        if (tierError) {
          tierErrors.push({ code, reason: `price tier "${tierError}" not recognized — use P1, P2, or P3` });
          continue;
        }
        if (seat.length > 0) out.seatHeightPrices = seat;

        rows.push(out);
      }

      if (rows.length === 0) {
        if (tierErrors.length > 0) {
          setResult({ upserted: 0, failed: tierErrors.length, failures: tierErrors });
        } else {
          setErrorMsg('No rows had a code. Every row needs a code, name, and category.');
        }
        setBusy(false);
        return;
      }

      const res = await batchImport.mutateAsync(rows);
      // Fold the client-side tier rejections into the result the operator sees.
      setResult(tierErrors.length > 0
        ? {
            upserted: res.upserted,
            failed: res.failed + tierErrors.length,
            failures: [...tierErrors, ...(res.failures ?? [])],
          }
        : res);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
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
          Pick a CSV exported from this page. Edit the prices in Excel, save, and
          import it back. A blank cell is left as it was — it never clears a price.
          Up to 500 SKUs per file.
        </p>
        <input
          type="file"
          accept=".csv"
          disabled={busy}
          style={{ marginTop: 'var(--space-3)' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />

        {busy && (
          <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
            Importing…
          </p>
        )}

        {errorMsg && (
          <p style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-13)', color: 'var(--c-danger, #b3261e)' }}>
            {errorMsg}
          </p>
        )}

        {result && (
          <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--fs-13)' }}>
            <div style={{ fontWeight: 600 }}>
              Imported {result.upserted}{result.failed > 0 ? `, failed ${result.failed}` : ''}.
            </div>
            {result.failures.length > 0 && (
              <ul style={{ marginTop: 'var(--space-2)', paddingLeft: '1.2em', color: 'var(--fg-muted)' }}>
                {result.failures.slice(0, 5).map((f, i) => (
                  <li key={i}>{f.code || '(no code)'}: {f.reason}</li>
                ))}
                {result.failures.length > 5 && <li>…and {result.failures.length - 5} more.</li>}
              </ul>
            )}
          </div>
        )}

        <footer style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
          <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   PR #89 — Click-to-edit cell for SKU Master code + name columns.
   Same UX as Fabric Converter DescriptionCell: chip → click → input,
   Enter / blur saves, Esc cancels. inline=true uses regular text styling
   (no chip pill); inline=false uses chipClassName for the resting state.
   ════════════════════════════════════════════════════════════════════════ */
const EditableTextCell = ({
  value, chipClassName, ariaLabel, onSave, inline = false, editable = true,
}: {
  value:          string;
  /** CSS-module class — typed loose so `styles.foo` (which TS treats as
      `string | undefined`) flows in without callers having to coalesce.
      PR #87 merge fix: PR #89 landed with this typed `string` which broke
      the build under `tsc -b --noEmit`. */
  chipClassName:  string | undefined;
  ariaLabel:      string;
  onSave:         (val: string) => void;
  inline?:        boolean;
  /** PR #95 — Commander 2026-05-26: gate click-to-edit behind the parent
      table's edit mode. When false, the cell renders as plain text/chip
      and any click is ignored. Defaults to true so existing callers
      (Fabric Converter description cell, etc.) keep working. */
  editable?:      boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value.trim()) {
      setEditing(false);
      setDraft(value);
      return;
    }
    onSave(trimmed);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) {
    // PR #95 — Read-only mode. Same visual chip / inline text but no
    // click target, no cursor pointer, no "Click to edit" tooltip.
    if (!editable) {
      return inline ? (
        <span className={chipClassName}>{value}</span>
      ) : (
        <span className={chipClassName}>{value}</span>
      );
    }
    return inline ? (
      <div
        role="button"
        tabIndex={0}
        className={chipClassName}
        title="Click to edit"
        onClick={() => { setDraft(value); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDraft(value); setEditing(true); } }}
        style={{ cursor: 'pointer' }}
      >
        {value}
      </div>
    ) : (
      <button
        type="button"
        className={chipClassName}
        title="Click to edit"
        aria-label={ariaLabel}
        onClick={() => { setDraft(value); setEditing(true); }}
        style={{ cursor: 'pointer' }}
      >
        {value}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter')      { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={{
        fontFamily: inline ? 'var(--font-sans)' : 'var(--font-mono)',
        fontSize:   'var(--fs-13)',
        fontWeight: 600,
        padding:    '4px 8px',
        border:     '1px solid var(--c-orange)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--c-cream)',
        outline:    'none',
        width:      '100%',
        maxWidth:   320,
      }}
    />
  );
};
