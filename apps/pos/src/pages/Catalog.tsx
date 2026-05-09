import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  LogOut,
  Hourglass,
  ShoppingCart,
  ListOrdered,
  Bookmark,
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
  AlertTriangle,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useAuth } from '../lib/auth';
import { useCatalog, useCatalogRealtime, type CatalogProduct } from '../lib/queries';
import { useCart, cartItemCount, cartSubtotal } from '../state/cart';
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

interface CatLite {
  id: string;
  label: string;
  icon: string;
  tbc: boolean;
}

interface SeriesLite {
  id: string;
  label: string;
}

export const Catalog = () => {
  const { user, signOut } = useAuth();
  const catalog = useCatalog();
  useCatalogRealtime();
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  const [activeCat, setActiveCat] = useState<string>('all');
  const [activeSeries, setActiveSeries] = useState<string>('all');
  const [query, setQuery] = useState('');

  const products = catalog.data ?? [];

  /* Derive categories + series from product list (since POS only has the
     /products endpoint — no separate library queries here). */
  const cats = useMemo<CatLite[]>(() => {
    const m = new Map<string, CatLite>();
    for (const p of products) {
      if (p.category) m.set(p.category.id, p.category);
    }
    return Array.from(m.values());
  }, [products]);

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
    <main className={styles.app}>
      <header className={styles.header}>
        <div>
          <span className="t-eyebrow">POS · Showroom KL</span>
          <h1 className={styles.heading}>Catalog</h1>
        </div>
        <div className={styles.headerRight}>
          <Link to="/quotes" className={styles.cartBadge} aria-label="Saved quotes">
            <Bookmark size={16} strokeWidth={1.75} />
            <span>Quotes</span>
          </Link>
          <Link to="/my-orders" className={styles.cartBadge} aria-label="My orders">
            <ListOrdered size={16} strokeWidth={1.75} />
            <span>My orders</span>
          </Link>
          <Link to="/cart" className={styles.cartBadge} aria-label="Cart">
            <ShoppingCart size={18} strokeWidth={1.75} />
            <span>{count > 0 ? `${count} · ${fmtRM(subtotal)}` : 'Cart empty'}</span>
          </Link>
          <span className={styles.email}>{user?.email}</span>
          <IconButton
            icon={<LogOut size={20} strokeWidth={1.75} />}
            aria-label="Sign out"
            onClick={() => void signOut()}
          />
        </div>
      </header>

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
  );
};

const ProductCard = ({ p }: { p: CatalogProduct }) => {
  const headlinePrice =
    p.pricing_kind === 'flat' && p.flat_price != null ? p.flat_price : null;
  const lowStock = p.stock <= p.low_at && p.stock > 0;
  const out = p.stock === 0;
  const tbc = p.pricing_kind === 'tbc';

  return (
    <Link
      to={tbc ? '#' : `/configure/${p.id}`}
      className={`${styles.card} ${tbc ? styles.cardDisabled : ''}`}
      onClick={(e) => { if (tbc) e.preventDefault(); }}
    >
      <div className={styles.photo}>
        <span className={styles.photoFallback}>{productInitial(p.name)}</span>
        {p.series && (
          <span className={styles.photoBadge}>{p.series.label}</span>
        )}
        {!out && (
          <span className={`${styles.photoStock} ${lowStock ? styles.photoStockLow : ''}`}>
            {lowStock
              ? <AlertTriangle size={10} strokeWidth={1.75} />
              : <Check size={10} strokeWidth={1.75} />}
            {p.stock} in stock
          </span>
        )}
        {out && (
          <span className={`${styles.photoStock} ${styles.photoStockOut}`}>
            <AlertTriangle size={10} strokeWidth={1.75} /> Out of stock
          </span>
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
              {p.pricing_kind === 'sofa_build' ? 'Configure' : 'By size'}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};
