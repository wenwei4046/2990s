import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Hourglass,
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
  type LucideIcon,
} from 'lucide-react';
import { Button, PriceTag } from '@2990s/design-system';
import { useCatalog, useCatalogRealtime, useCategoriesAll, type CatalogProduct } from '../lib/queries';
import { Topbar } from '../components/Topbar';
import { CustomerOrderFab } from '../components/CustomerOrderFab';
import styles from './Catalog.module.css';

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

interface SeriesLite {
  id: string;
  label: string;
}

export const Catalog = () => {
  const catalog = useCatalog();
  useCatalogRealtime();
  const allCategories = useCategoriesAll();

  const [activeCat, setActiveCat] = useState<string>('all');
  const [activeSeries, setActiveSeries] = useState<string>('all');
  const [query, setQuery] = useState('');

  const products = catalog.data ?? [];

  // Categories come from the categories table directly (not derived from
  // products) so TBC ones still render even with zero products. Series still
  // come from products since only series with at least one product are useful
  // as a filter.
  const cats = allCategories.data ?? [];

  const seriesList = useMemo<SeriesLite[]>(() => {
    const m = new Map<string, SeriesLite>();
    for (const p of products) {
      if (p.series) m.set(p.series.id, p.series);
    }
    return Array.from(m.values());
  }, [products]);

  const liveCats = cats.filter((c) => !c.tbc);
  const tbcCats = cats.filter((c) => c.tbc);

  const counts = useMemo(() => {
    const open = new Set(liveCats.map((c) => c.id));
    const c: Record<string, number> = {
      all: products.filter((p) => p.category && open.has(p.category.id)).length,
    };
    for (const cat of cats) {
      c[cat.id] = products.filter((p) => p.category?.id === cat.id).length;
    }
    return c;
  }, [products, cats, liveCats]);

  const filtered = useMemo(() => {
    const open = new Set(liveCats.map((c) => c.id));
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat === 'all') {
        if (!p.category || !open.has(p.category.id)) return false;
      } else if (p.category?.id !== activeCat) {
        return false;
      }
      if (activeSeries !== 'all' && p.series?.id !== activeSeries) return false;
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.detail?.toLowerCase().includes(q) ?? false);
        if (!hit) return false;
      }
      return true;
    });
  }, [products, activeCat, activeSeries, query, liveCats]);

  const resetFilters = () => {
    setActiveCat('all');
    setActiveSeries('all');
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
      ) : products.length === 0 ? (
        <p className={styles.empty}>
          No products yet. Ask your admin to seed the catalogue via the Backend SKU Master.
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
                  placeholder="Name, SKU, detail…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                className={styles.select}
                value={activeSeries}
                onChange={(e) => setActiveSeries(e.target.value)}
              >
                <option value="all">All series</option>
                {seriesList.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
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
                {filtered.map((p) => <ProductCard key={p.id} p={p} />)}
              </div>
            )}
          </section>

        </div>
      )}

      <footer className={styles.footer}>
        <span className="t-caption">
          Phase 1 acceptance gate · Realtime subscription on <code>products</code> table.
          Edits in Backend SKU Master appear here within ~300ms.
        </span>
      </footer>
    </main>
    <CustomerOrderFab />
    </>
  );
};

const ProductCard = ({ p }: { p: CatalogProduct }) => {
  const headlinePrice =
    p.pricing_kind === 'flat' && p.flat_price != null ? p.flat_price : null;
  const tbc = p.pricing_kind === 'tbc';

  return (
    <Link
      to={tbc ? '#' : `/configure/${p.id}`}
      className={`${styles.card} ${tbc ? styles.cardDisabled : ''}`}
      onClick={(e) => { if (tbc) e.preventDefault(); }}
    >
      <div
        className={styles.photo}
        style={p.img_key ? { backgroundImage: `url(${p.img_key})` } : undefined}
      >
        {!p.img_key && (
          <span className={styles.photoFallback}>{productInitial(p.name)}</span>
        )}
        {p.series && (
          <span className={styles.photoBadge} data-brand={p.series.id}>{p.series.label}</span>
        )}
      </div>
      <div className={styles.body}>
        {p.size_display && <div className={styles.eyebrow}>{p.size_display}</div>}
        <div className={styles.name}>{p.name}</div>
        {p.detail && <div className={styles.detail}>{p.detail}</div>}
        <div className={styles.priceRow}>
          <code className={styles.sku}>{p.sku}</code>
          {tbc ? (
            <span className={styles.tbc}>
              <Hourglass size={12} strokeWidth={1.75} /> TBC
            </span>
          ) : headlinePrice != null ? (
            <PriceTag amount={headlinePrice} size="sm" />
          ) : (
            <span className={styles.fromLabel}>
              {p.pricing_kind === 'sofa_build' || p.pricing_kind === 'bedframe_build' ? 'Configure' : 'By size'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};
