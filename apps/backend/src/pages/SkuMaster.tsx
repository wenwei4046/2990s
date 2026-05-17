import { useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Eye,
  EyeOff,
  Hourglass,
  AlertTriangle,
  AlertCircle,
  Package,
  Search,
  X,
  CheckSquare,
  Minus,
  PackageSearch,
  Download,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { useCategories, useProducts, useSeries, type ProductRow } from '../lib/queries';
import { useUpdateProduct, useBulkSetProductVisibility } from '../lib/admin-queries';
import { SkuDrawer } from '../components/SkuDrawer';
import { CategoryHeroSection } from '../components/CategoryHeroSection';
import styles from './SkuMaster.module.css';

type DrawerState =
  | { open: false }
  | { open: true; mode: 'create'; product: null }
  | { open: true; mode: 'edit'; product: ProductRow };

type ViewFilter = 'all' | 'low' | 'hidden' | 'tbc';

const fmtMoneyNum = (n: number | null): string =>
  n == null ? '—' : `RM ${n.toLocaleString('en-MY')}`;

// Series chip palette — hash-stable so the same series id always maps to the
// same colour without us having to seed colours per series row.
const SERIES_COLORS: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: 'rgba(232, 107, 58, 0.12)', fg: 'var(--c-burnt)' },
  { bg: 'rgba(47, 93, 79, 0.12)', fg: 'var(--c-secondary-a)' },
  { bg: 'rgba(31, 58, 138, 0.10)', fg: 'var(--c-secondary-b)' },
  { bg: 'rgba(34, 31, 32, 0.06)', fg: 'var(--c-ink)' },
  { bg: 'var(--bg-alt)', fg: 'var(--fg-muted)' },
];

const NEUTRAL_COLOR = SERIES_COLORS[4]!;
const seriesColor = (id: string | null): { bg: string; fg: string } => {
  if (!id) return NEUTRAL_COLOR;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return SERIES_COLORS[Math.abs(h) % SERIES_COLORS.length] ?? NEUTRAL_COLOR;
};

const productInitial = (name: string): string =>
  name?.trim()?.charAt(0)?.toUpperCase() ?? '?';

export const SkuMaster = () => {
  const { staff } = useAuth();
  const products = useProducts();
  const cats = useCategories();
  const seriesList = useSeries();
  const updateProduct = useUpdateProduct();
  const bulkVisibility = useBulkSetProductVisibility();

  const [drawer, setDrawer] = useState<DrawerState>({ open: false });
  const [view, setView] = useState<ViewFilter>('all');
  const [cat, setCat] = useState<string>('all');
  const [series, setSeries] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  const isAdmin = staff?.role === 'admin';
  const allCats = cats.data ?? [];
  const allSeries = seriesList.data ?? [];
  const liveCats = allCats.filter((c) => !c.tbc);
  const tbcCats = allCats.filter((c) => c.tbc);
  const list = products.data ?? [];

  const catLabel = (id: string) => allCats.find((c) => c.id === id)?.label ?? id;
  const seriesLabel = (id: string | null) =>
    !id ? '—' : allSeries.find((s) => s.id === id)?.label ?? id;

  /* ─── Stat counts ─── */
  const counts = useMemo(() => {
    const tbcCatIds = new Set(tbcCats.map((c) => c.id));
    return {
      all: list.length,
      low: list.filter((p) => p.stock <= p.lowAt).length,
      hidden: list.filter((p) => !p.visible).length,
      tbc: list.filter((p) => tbcCatIds.has(p.categoryId)).length,
    };
  }, [list, tbcCats]);

  /* ─── Filter rows ─── */
  const filtered = useMemo(() => {
    const tbcCatIds = new Set(tbcCats.map((c) => c.id));
    const q = query.trim().toLowerCase();
    return list.filter((p) => {
      if (cat !== 'all' && p.categoryId !== cat) return false;
      if (series !== 'all' && p.seriesId !== series) return false;
      if (view === 'low' && p.stock > p.lowAt) return false;
      if (view === 'hidden' && p.visible) return false;
      if (view === 'tbc' && !tbcCatIds.has(p.categoryId)) return false;
      if (!q) return true;
      const slabel = seriesLabel(p.seriesId).toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        slabel.includes(q) ||
        (p.detail ?? '').toLowerCase().includes(q)
      );
    });
  }, [list, cat, series, view, query, tbcCats]);

  /* ─── Selection helpers ─── */
  const visibleIds = filtered.map((p) => p.id);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelected((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };
  const toggleOne = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const priceRangeLabel = (p: ProductRow): string => {
    if (p.pricingKind === 'flat' && p.flatPrice != null) return fmtMoneyNum(p.flatPrice);
    if (p.pricingKind === 'tbc') return 'TBC';
    if (p.pricingKind === 'sofa_build') return 'per build';
    if (p.pricingKind === 'size_variants') return 'by size';
    return '—';
  };

  /* ─── Mutations (admin-only) ─── */
  const bumpStock = (p: ProductRow, delta: number) => {
    if (!isAdmin) return;
    const next = Math.max(0, p.stock + delta);
    if (next === p.stock) return;
    updateProduct.mutate({ id: p.id, patch: { stock: next } });
  };
  const toggleVisibility = (p: ProductRow) => {
    if (!isAdmin) return;
    updateProduct.mutate({ id: p.id, patch: { visible: !p.visible } });
  };
  const bulkShow = () => {
    if (!isAdmin || selected.length === 0) return;
    bulkVisibility.mutate(
      { ids: selected, visible: true },
      { onSuccess: () => setSelected([]) },
    );
  };
  const bulkHide = () => {
    if (!isAdmin || selected.length === 0) return;
    bulkVisibility.mutate(
      { ids: selected, visible: false },
      { onSuccess: () => setSelected([]) },
    );
  };

  /* ─── Render ─── */
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className="t-eyebrow">Pricing rules · per SKU</div>
          <h2 className={styles.title}>SKU Master</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Mattress &amp; bedframe priced by size · Sofa priced by build (compartments + bundles, per Model).
            Toggle off any variant that doesn&apos;t apply to a specific Model.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => setDrawer({ open: true, mode: 'create', product: null })}
          >
            <Plus size={16} strokeWidth={1.75} />
            New SKU
          </Button>
        )}
      </header>

      {!isAdmin && (
        <div className={styles.readOnlyBanner}>
          <strong>Read-only view.</strong> Catalogue editing is admin-only. Ask Loo for access if you need to add or change a SKU.
        </div>
      )}

      {/* ─── Stat strip ─── */}
      <div className={styles.statStrip}>
        <StatCard
          label="All SKUs"
          value={counts.all}
          Icon={Package}
          active={view === 'all'}
          onClick={() => setView('all')}
        />
        <StatCard
          label="Low stock"
          value={counts.low}
          Icon={AlertCircle}
          tone="warn"
          hint="≤ threshold"
          active={view === 'low'}
          onClick={() => setView('low')}
        />
        <StatCard
          label="Hidden"
          value={counts.hidden}
          Icon={EyeOff}
          hint="Not on showroom"
          active={view === 'hidden'}
          onClick={() => setView('hidden')}
        />
        <StatCard
          label="To-be-conf."
          value={counts.tbc}
          Icon={Hourglass}
          tone="muted"
          hint="Range pending"
          active={view === 'tbc'}
          onClick={() => setView('tbc')}
        />
      </div>

      {/* ─── Filter row ─── */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${cat === 'all' ? styles.tabActive : ''}`}
            onClick={() => setCat('all')}
          >
            All<span className={styles.tabCount}>{list.length}</span>
          </button>
          {liveCats.map((c) => {
            const n = list.filter((p) => p.categoryId === c.id).length;
            if (!n) return null;
            return (
              <button
                key={c.id}
                type="button"
                className={`${styles.tab} ${cat === c.id ? styles.tabActive : ''}`}
                onClick={() => setCat(c.id)}
              >
                {c.label}<span className={styles.tabCount}>{n}</span>
              </button>
            );
          })}
          {tbcCats.length > 0 && <span className={styles.tabDivider} />}
          {tbcCats.map((c) => {
            const n = list.filter((p) => p.categoryId === c.id).length;
            if (!n) return null;
            return (
              <button
                key={c.id}
                type="button"
                className={`${styles.tab} ${styles.tabTbc} ${cat === c.id ? styles.tabActive : ''}`}
                onClick={() => setCat(c.id)}
                title="Range still being finalised"
              >
                <Hourglass size={11} strokeWidth={1.75} />
                {c.label}<span className={styles.tabCount}>{n}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.toolbarRight}>
          <select
            className={styles.select}
            value={series}
            onChange={(e) => setSeries(e.target.value)}
          >
            <option value="all">All series</option>
            {allSeries.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <div className={styles.search}>
            <Search size={14} strokeWidth={1.75} />
            <input
              type="search"
              placeholder="Name, SKU, series, detail…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X size={12} strokeWidth={1.75} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bulk action bar ─── */}
      {selected.length > 0 && isAdmin && (
        <div className={styles.bulkBar}>
          <div className={styles.bulkCount}>
            <CheckSquare size={14} strokeWidth={1.75} />
            <strong>{selected.length}</strong> selected
          </div>
          <button
            type="button"
            className={styles.bulkBtn}
            onClick={bulkShow}
            disabled={bulkVisibility.isPending}
          >
            <Eye size={14} strokeWidth={1.75} />Show on showroom
          </button>
          <button
            type="button"
            className={styles.bulkBtn}
            onClick={bulkHide}
            disabled={bulkVisibility.isPending}
          >
            <EyeOff size={14} strokeWidth={1.75} />Hide
          </button>
          <button type="button" className={styles.bulkBtn} disabled title="Coming soon">
            <Download size={14} strokeWidth={1.75} />Export CSV
          </button>
          <button
            type="button"
            className={`${styles.bulkBtn} ${styles.bulkBtnGhost}`}
            onClick={() => setSelected([])}
          >
            Clear
          </button>
        </div>
      )}

      {/* ─── Table ─── */}
      <div className={styles.tableCard}>
        {products.isLoading ? (
          <div className={styles.empty}>Loading products…</div>
        ) : products.error ? (
          <div className={styles.empty}>Failed to load: {String(products.error)}</div>
        ) : list.length === 0 ? (
          <EmptyState
            isAdmin={isAdmin}
            onNew={() => setDrawer({ open: true, mode: 'create', product: null })}
          />
        ) : filtered.length === 0 ? (
          <FilterEmptyState
            onReset={() => {
              setQuery('');
              setCat('all');
              setSeries('all');
              setView('all');
            }}
          />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                {isAdmin && (
                  <th className={styles.checkCol}>
                    <Check checked={allSelected} onChange={toggleAll} />
                  </th>
                )}
                <th className={styles.photoCol} aria-label="Photo" />
                <th>Product</th>
                <th className={styles.skuCol}>SKU</th>
                <th className={styles.seriesCol}>Series</th>
                <th className={styles.sizeCol}>Size</th>
                <th className={styles.stockCol}>Stock</th>
                <th className={styles.priceCol}>Price</th>
                <th className={styles.visCol}>Visible</th>
                {isAdmin && <th className={styles.actCol} aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const c = allCats.find((x) => x.id === p.categoryId);
                const tbc = c?.tbc ?? false;
                const low = p.stock <= p.lowAt;
                const out = p.stock === 0;
                const sColor = seriesColor(p.seriesId);
                const isSelected = selected.includes(p.id);
                const sLabel = seriesLabel(p.seriesId);

                return (
                  <tr
                    key={p.id}
                    className={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${!p.visible ? styles.rowHidden : ''}`}
                    onClick={() => setDrawer({ open: true, mode: isAdmin ? 'edit' : 'edit', product: p })}
                  >
                    {isAdmin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <Check checked={isSelected} onChange={() => toggleOne(p.id)} />
                      </td>
                    )}
                    <td>
                      <span className={styles.photo}>{productInitial(p.name)}</span>
                    </td>
                    <td>
                      <div className={styles.productCell}>
                        <span className={styles.productName}>
                          {p.name}
                          {tbc && (
                            <span className={`${styles.miniPill} ${styles.miniPillTbc}`}>
                              <Hourglass size={10} strokeWidth={1.75} />TBC
                            </span>
                          )}
                          {!p.visible && (
                            <span className={`${styles.miniPill} ${styles.miniPillHidden}`}>
                              <EyeOff size={10} strokeWidth={1.75} />Hidden
                            </span>
                          )}
                          {p.pricingKind === 'sofa_build' && (p.reclinerUpgradePrice ?? 0) === 0 && (
                            <span className={styles.unpricedBadge} title="Sofa build prices not yet set">
                              <AlertTriangle size={11} strokeWidth={1.75} /> unpriced
                            </span>
                          )}
                        </span>
                        {p.detail && (
                          <span className={styles.productDetail}>{p.detail}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <code className={styles.sku}>{p.sku}</code>
                    </td>
                    <td>
                      <span
                        className={styles.seriesChip}
                        style={{ background: sColor.bg, color: sColor.fg }}
                      >
                        {sLabel}
                      </span>
                    </td>
                    <td>
                      <span className={styles.sizeText}>{p.sizeDisplay ?? '—'}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className={styles.stepper}>
                        <button
                          type="button"
                          className={styles.stepperBtn}
                          onClick={() => bumpStock(p, -1)}
                          disabled={!isAdmin || out}
                          aria-label="Decrease stock"
                        >
                          <Minus size={12} strokeWidth={1.75} />
                        </button>
                        <span
                          className={`${styles.stepperVal} ${out ? styles.stepperOut : low ? styles.stepperLow : ''}`}
                        >
                          {out ? 'Out' : p.stock}
                          {low && !out && (
                            <span className={styles.stepperDot} title={`Low — ≤ ${p.lowAt}`} />
                          )}
                        </span>
                        <button
                          type="button"
                          className={styles.stepperBtn}
                          onClick={() => bumpStock(p, +1)}
                          disabled={!isAdmin}
                          aria-label="Increase stock"
                        >
                          <Plus size={12} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                    <td>
                      {p.pricingKind === 'tbc' ? (
                        <span className={styles.tbcPill}>
                          <Hourglass size={11} strokeWidth={1.75} /> TBC
                        </span>
                      ) : (
                        <span className={styles.priceLabel}>{priceRangeLabel(p)}</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={`${styles.toggle} ${p.visible ? styles.toggleOn : ''}`}
                        onClick={() => toggleVisibility(p)}
                        disabled={!isAdmin}
                        aria-label={p.visible ? 'Hide on showroom' : 'Show on showroom'}
                      >
                        <span className={styles.toggleKnob} />
                      </button>
                    </td>
                    {isAdmin && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => setDrawer({ open: true, mode: 'edit', product: p })}
                          aria-label={`Edit ${p.sku}`}
                        >
                          <Pencil size={16} strokeWidth={1.75} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {list.length > 0 && (
        <div className={styles.foot}>
          Showing <strong>{filtered.length}</strong> of {list.length} SKUs
        </div>
      )}

      {/* Task 18 — admin/coordinator can upload one hero image per category. */}
      <CategoryHeroSection />

      {drawer.open && (
        <SkuDrawer
          mode={drawer.mode}
          product={drawer.mode === 'edit' ? drawer.product : null}
          onClose={() => setDrawer({ open: false })}
        />
      )}
    </div>
  );
};

/* ─── Sub-components ─── */

const StatCard = ({
  label,
  value,
  Icon,
  tone,
  hint,
  active,
  onClick,
}: {
  label: string;
  value: number;
  Icon: typeof Package;
  tone?: 'warn' | 'muted';
  hint?: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className={`${styles.stat} ${active ? styles.statActive : ''} ${tone === 'warn' ? styles.statWarn : ''} ${tone === 'muted' ? styles.statMuted : ''}`}
    onClick={onClick}
  >
    <span className={styles.statIcon}>
      <Icon size={20} strokeWidth={1.75} />
    </span>
    <span className={styles.statBody}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </span>
  </button>
);

const Check = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) => (
  <button
    type="button"
    className={`${styles.check} ${checked ? styles.checkOn : ''}`}
    onClick={onChange}
    aria-label={checked ? 'Deselect' : 'Select'}
  >
    {checked && <span className={styles.checkMark}>✓</span>}
  </button>
);

const EmptyState = ({
  isAdmin,
  onNew,
}: {
  isAdmin: boolean;
  onNew: () => void;
}) => (
  <div className={styles.empty}>
    <h3 className={styles.emptyTitle}>No SKUs yet</h3>
    <p className="t-body fg-muted">
      Production starts with an empty catalogue (per PORT_DESIGN.md §10 Decision 10).
      {isAdmin
        ? ' Click New SKU to seed the first product.'
        : ' An admin needs to seed the catalogue before sales can sell.'}
    </p>
    {isAdmin && (
      <Button variant="primary" onClick={onNew}>
        <Plus size={16} strokeWidth={1.75} />
        New SKU
      </Button>
    )}
  </div>
);

const FilterEmptyState = ({ onReset }: { onReset: () => void }) => (
  <div className={styles.empty}>
    <PackageSearch size={28} strokeWidth={1.5} />
    <h3 className={styles.emptyTitle}>No SKUs match those filters</h3>
    <p className="t-body fg-muted">
      Try clearing the search or switching category.
    </p>
    <button type="button" className={styles.resetBtn} onClick={onReset}>
      Reset filters
    </button>
  </div>
);
