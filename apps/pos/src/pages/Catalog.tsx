import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Package,
  Sofa,
  Bed,
  Bath,
  Coffee,
  Baby,
  Star,
  Search,
  RotateCcw,
  Sparkles,
  ImageOff,
  type LucideIcon,
} from 'lucide-react';
import { useMfgCatalog, useMfgCatalogRealtime, useCategoriesAll, type MfgCatalogRow } from '../lib/queries';
import { Topbar } from '../components/Topbar';
import { CustomerOrderFab } from '../components/CustomerOrderFab';
import styles from './Catalog.module.css';

// PR — Commander 2026-05-27: Catalog now reads `mfg_products` (Backend SKU
// Master output) JOINed with `product_models` (photo + Model-level metadata).
// Replaces the prototype's hardcoded `/products` read which never got seeded.
// Sidebar counts roll up from the live mfg_products list; cards render the
// Model photo commander uploaded via Backend → Products → Modular tab.

const CAT_ICON: Record<string, LucideIcon> = {
  sofa: Sofa,
  mattress: Bed,
  bedframe: Bed,
  dining: Coffee,
  bathroom: Bath,
  kids: Baby,
  accessory: Star,
};

const productInitial = (name: string): string =>
  name?.trim()?.charAt(0)?.toUpperCase() ?? '?';

/** Group SKUs by Model so the grid renders one card per Model, not one per
 *  SKU. A Model with 6 sizes would otherwise spam the grid with 6 identical
 *  photos. Cards then show "By size" / "6 variants" as the price hint. */
interface CatalogCard {
  modelKey:    string;       // model_id when present, else SKU id (orphan)
  categoryId:  string;
  name:        string;
  description: string | null;
  branding:    string | null;
  photoUrl:    string | null;
  /** Lead SKU's code — shown on the card chip + used in the configure link. */
  leadSku:     string;
  leadSkuId:   string;
  variantCount: number;
  /** Lowest base price among variants (sen). null when no SKU has a price. */
  minPriceSen: number | null;
  /** All matching mfg_product ids — used for filter scoring. */
  skuCodes:    string[];
}

function buildCards(rows: MfgCatalogRow[]): CatalogCard[] {
  const groups = new Map<string, CatalogCard>();
  for (const r of rows) {
    const key = r.modelId ?? r.id; // orphan SKUs (no model) get their own card
    const existing = groups.get(key);
    if (existing) {
      existing.variantCount += 1;
      existing.skuCodes.push(r.code);
      if (r.basePriceSen != null && (existing.minPriceSen == null || r.basePriceSen < existing.minPriceSen)) {
        existing.minPriceSen = r.basePriceSen;
      }
      continue;
    }
    groups.set(key, {
      modelKey:     key,
      categoryId:   r.categoryId,
      // Prefer the Model's name (clean — "ADDA") over the SKU's name
      // ("SOFA ADDA 1A(LHF)") so cards read like a product, not a line item.
      name:         r.modelName ?? r.name,
      description:  r.description,
      branding:     r.branding,
      photoUrl:     r.photoUrl,
      leadSku:      r.code,
      leadSkuId:    r.id,
      variantCount: 1,
      minPriceSen:  r.basePriceSen,
      skuCodes:     [r.code],
    });
  }
  // Stable sort: by name within each category, but the grid layer doesn't
  // know about categories so we just sort by name globally.
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export const Catalog = () => {
  const catalog = useMfgCatalog();
  useMfgCatalogRealtime();
  const allCategories = useCategoriesAll();

  const [activeCat, setActiveCat] = useState<string>('all');
  const [activeBranding, setActiveBranding] = useState<string>('all');
  const [query, setQuery] = useState('');

  const rows = catalog.data ?? [];
  const cards = useMemo(() => buildCards(rows), [rows]);

  // Categories come from the categories table directly (not derived from
  // products) so TBC ones still render even with zero products. Brandings
  // come from the live data since only seeded brands are useful as a filter.
  const cats = allCategories.data ?? [];

  const brandingList = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.branding) set.add(r.branding);
    return Array.from(set).sort();
  }, [rows]);

  const liveCats = cats.filter((c) => !c.tbc);
  const tbcCats = cats.filter((c) => c.tbc);

  // Counts roll up at the card layer (one per Model) so the sidebar reads
  // "Sofas · 12" instead of "Sofas · 180" when each Model has 15 SKUs.
  const counts = useMemo(() => {
    const open = new Set(liveCats.map((c) => c.id));
    const c: Record<string, number> = {
      all: cards.filter((p) => open.has(p.categoryId)).length,
    };
    for (const cat of cats) {
      c[cat.id] = cards.filter((p) => p.categoryId === cat.id).length;
    }
    return c;
  }, [cards, cats, liveCats]);

  const filtered = useMemo(() => {
    const open = new Set(liveCats.map((c) => c.id));
    const q = query.trim().toLowerCase();
    return cards.filter((p) => {
      if (activeCat === 'all') {
        if (!open.has(p.categoryId)) return false;
      } else if (p.categoryId !== activeCat) {
        return false;
      }
      if (activeBranding !== 'all' && p.branding !== activeBranding) return false;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.skuCodes.some((s) => s.toLowerCase().includes(q)) ||
          (p.description?.toLowerCase().includes(q) ?? false) ||
          (p.branding?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });
  }, [cards, activeCat, activeBranding, query, liveCats]);

  const resetFilters = () => {
    setActiveCat('all');
    setActiveBranding('all');
    setQuery('');
  };

  const iconFor = (catId?: string | null): LucideIcon =>
    catId ? CAT_ICON[catId] ?? Package : Package;

  return (
    <>
      <Topbar step="cart" />
      <main className={styles.app}>
      {catalog.isLoading ? (
        <p className={styles.empty}>Loading catalog…</p>
      ) : catalog.error ? (
        <p className={styles.empty}>Failed to load: {String(catalog.error)}</p>
      ) : cards.length === 0 ? (
        <p className={styles.empty}>
          No products yet — ask admin to add via Backend → Products & Maintenance → Modular.
        </p>
      ) : (
        <div className={styles.layout}>
          {/* ─── Left rail ─── */}
          <aside className={styles.sidebar}>
            <div className={styles.sideHeading}>Categories</div>
            <button
              type="button"
              className={`${styles.sideItem} ${activeCat === 'all' ? styles.sideItemActive : ''}`}
              onClick={() => setActiveCat('all')}
            >
              <Package size={16} strokeWidth={1.75} />
              <span className={styles.sideLabel}>All open</span>
              <span className={styles.sideCount}>{counts.all}</span>
            </button>
            {liveCats.map((c) => {
              const Icon = iconFor(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`${styles.sideItem} ${activeCat === c.id ? styles.sideItemActive : ''}`}
                  onClick={() => setActiveCat(c.id)}
                >
                  <Icon size={16} strokeWidth={1.75} />
                  <span className={styles.sideLabel}>{c.label}</span>
                  <span className={styles.sideCount}>{counts[c.id] ?? 0}</span>
                </button>
              );
            })}

            {tbcCats.length > 0 && (
              <>
                <div className={styles.sideHeading}>To be confirmed</div>
                {tbcCats.map((c) => {
                  const Icon = iconFor(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={`${styles.sideItem} ${styles.sideItemTbc}`}
                      disabled
                      title="This range is being finalised — opening soon."
                    >
                      <Icon size={16} strokeWidth={1.75} />
                      <span className={styles.sideLabel}>{c.label}</span>
                      <span className={styles.sidePill}>Soon</span>
                    </button>
                  );
                })}
              </>
            )}

            <div className={styles.sideHeading}>Quick</div>
            <button
              type="button"
              className={styles.sideItem}
              onClick={resetFilters}
            >
              <RotateCcw size={16} strokeWidth={1.75} />
              <span className={styles.sideLabel}>Reset filters</span>
            </button>
            <button
              type="button"
              className={styles.sideItem}
              onClick={() => setActiveCat('mattress')}
            >
              <Sparkles size={16} strokeWidth={1.75} />
              <span className={styles.sideLabel}>Bestsellers</span>
            </button>

            <div className={styles.sideFooter}>
              <div className={styles.sideBrand}>Honest pricing</div>
              <p className={styles.sideBrandBody}>
                Every Model has its own price. No markups, no surprises.
              </p>
            </div>
          </aside>

          {/* ─── Main grid ─── */}
          <section className={styles.main}>
            <div className={styles.toolbar}>
              <div className={styles.search}>
                <Search size={14} strokeWidth={1.75} />
                <input
                  type="search"
                  placeholder="Name, SKU, brand…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                className={styles.select}
                value={activeBranding}
                onChange={(e) => setActiveBranding(e.target.value)}
              >
                <option value="all">All series</option>
                {brandingList.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className={styles.toolbarCount}>
                {filtered.length} {filtered.length === 1 ? 'piece' : 'pieces'}
              </span>
            </div>

            {filtered.length === 0 ? (
              <div className={styles.gridEmpty}>
                <h4>No pieces match.</h4>
                <p>Try clearing the search or pick a different category.</p>
                <button type="button" className={styles.resetBtn} onClick={resetFilters}>
                  Reset filters
                </button>
              </div>
            ) : (
              <div className={styles.grid}>
                {filtered.map((p) => <ProductCard key={p.modelKey} p={p} />)}
              </div>
            )}
          </section>

        </div>
      )}

      <footer className={styles.footer}>
        <span className="t-caption">
          Reads <code>mfg_products</code> × <code>product_models</code> via Supabase Realtime.
          Edits in Backend → Products & Maintenance land here within ~300ms.
        </span>
      </footer>
    </main>
    <CustomerOrderFab />
    </>
  );
};

const ProductCard = ({ p }: { p: CatalogCard }) => {
  // PR — Commander wanted a "Configure" affordance even when SKUs are not
  // wired into the production configurator yet. For now the card links to
  // the Configurator route using the lead SKU's id; the Configurator will
  // fall back to placeholder for unknown ids.
  return (
    <Link
      to={`/configure/${p.leadSkuId}`}
      className={styles.card}
    >
      <div
        className={styles.photo}
        style={p.photoUrl ? { backgroundImage: `url(${p.photoUrl})` } : undefined}
      >
        {!p.photoUrl && (
          <span className={styles.photoFallback}>{productInitial(p.name)}</span>
        )}
        {p.branding && (
          <span className={styles.photoBadge} data-brand={p.branding.toLowerCase()}>{p.branding}</span>
        )}
        {!p.photoUrl && (
          // PR — show a small "no photo" hint on the placeholder so commander
          // can tell at-a-glance which Models still need their hero uploaded.
          <span className={styles.photoEmptyHint} title="No photo uploaded yet">
            <ImageOff size={12} strokeWidth={1.75} /> No photo
          </span>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.name}>{p.name}</div>
        {p.description && <div className={styles.detail}>{p.description}</div>}
        <div className={styles.priceRow}>
          <code className={styles.sku}>{p.leadSku}</code>
          <span className={styles.fromLabel}>
            {p.variantCount > 1 ? `${p.variantCount} variants` : 'By size'}
          </span>
        </div>
      </div>
    </Link>
  );
};
